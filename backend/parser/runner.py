import os
import json
from pathlib import Path
from .base import ParseResult
from .registry import get_parser
from .merger import merge

# trigger registration
from . import langs  # noqa: F401


def parse_repo(repo_path: str, repo_name: str = "", language: str = "swift") -> dict:
    results = []

    for dirpath, _, filenames in os.walk(repo_path):
        for fname in filenames:
            ext = Path(fname).suffix
            parser = get_parser(ext)
            if parser is None:
                continue

            full_path = os.path.join(dirpath, fname)
            relative_path = os.path.relpath(full_path, repo_path).replace(os.sep, "/")
            try:
                file_result = parser.parse_file(full_path)
                file_result.path = relative_path

                partial = ParseResult(
                    language=parser.language,
                    repo=repo_name,
                    files=[file_result]
                )
                results.append(partial)

            except Exception as e:
                print(f"[warn] skipping {full_path}: {e}")

    merged = merge(results)
    _refine_call_kinds(merged)
    _resolve_implicit_self(merged)
    _tag_http(merged)
    return _to_dict(merged)


# PascalCase global functions that are NOT initializers.
# Almost everything PascalCase in Swift IS a type initializer;
# these are the known exceptions (XCTest assertion family).
_PASCAL_GLOBAL_FUNCS = {
    'XCTAssertEqual', 'XCTAssertNotEqual',
    'XCTAssertNil', 'XCTAssertNotNil',
    'XCTAssertTrue', 'XCTAssertFalse',
    'XCTAssertThrowsError', 'XCTAssertNoThrow',
    'XCTAssertIdentical', 'XCTAssertNotIdentical',
    'XCTAssertGreaterThan', 'XCTAssertGreaterThanOrEqual',
    'XCTAssertLessThan', 'XCTAssertLessThanOrEqual',
    'XCTFail', 'XCTExpectFailure',
    'XCTSkip', 'XCTSkipIf', 'XCTSkipUnless', 'XCTUnwrap',
}


def _refine_call_kinds(result: ParseResult) -> None:
    """Demote known PascalCase global functions from 'initializer' to 'call'.

    The parser tags any bare PascalCase callee as 'initializer'. That's correct
    for the vast majority of Swift code (UUID(), URL(), Todo(), ...) but wrong
    for the XCTest assertion family which are global functions, not types.
    """
    for f in result.files:
        for fn in f.functions:
            for c in fn.calls:
                if c.kind == "initializer" and c.target in _PASCAL_GLOBAL_FUNCS:
                    c.kind = "call"


def _resolve_implicit_self(result: ParseResult) -> None:
    """Promote bare calls to 'method' when the target matches a sibling method name.

    Swift allows calling methods without explicit `self.` inside a type body.
    The parser emits these as kind='call' with receiver=None because it has no
    type info. This pass checks: if a bare call target matches the name of another
    method in the same container, promote it to kind='method' with receiver='self'.
    """
    for f in result.files:
        # Build a set of method names per container
        methods_by_container: dict[str, set[str]] = {}
        for fn in f.functions:
            if fn.container:
                methods_by_container.setdefault(fn.container, set()).add(fn.name)

        for fn in f.functions:
            if not fn.container:
                continue
            siblings = methods_by_container.get(fn.container, set())
            for c in fn.calls:
                if c.kind == "call" and c.receiver is None and c.method in siblings:
                    c.kind = "method"
                    c.receiver = "self"
                    c.target = f"self.{c.target}"

def _tag_http(result: ParseResult) -> None:
    ROUTE_DECORATORS = {"route", "get", "post", "put", "delete", "patch", "api_view"}
    HTTP_CALLERS = {"fetch", "axios", "get", "post", "put", "delete", "patch"}

    for f in result.files:
        for fn in f.functions:
            # Python endpoints: @app.route, @router.get, etc.
            for tag in fn.tags:
                name = tag.lstrip("@").split(".")[-1].lower()
                if name in ROUTE_DECORATORS:
                    fn.tags.append("http:endpoint")
                    break

            # JS callers: fetch(), axios.post(), etc.
            for c in fn.calls:
                if c.method in HTTP_CALLERS and c.kind in ("call", "method"):
                    fn.tags.append("http:client")
                    break

def parse_file(file_path: str, repo_name: str = "") -> dict:
    ext = Path(file_path).suffix
    parser = get_parser(ext)
    if parser is None:
        raise ValueError(f"No parser registered for extension '{ext}'")

    file_result = parser.parse_file(file_path)
    result = ParseResult(
        language=parser.language,
        repo=repo_name,
        files=[file_result]
    )
    _refine_call_kinds(result)
    _resolve_implicit_self(result)
    _tag_http(result)
    return _to_dict(result)


from dataclasses import asdict

def _to_dict(result: ParseResult) -> dict:
    return asdict(result)