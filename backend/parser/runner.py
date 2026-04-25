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
            relative_path = os.path.relpath(full_path, repo_path)

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
    return _to_dict(merged)


def _refine_call_kinds(result: ParseResult) -> None:
    """Demote 'initializer' calls whose target isn't a known type to 'call'.

    The Swift parser tags any bare PascalCase callee as 'initializer' on a guess.
    Once we have the full corpus we can check the union of declared types and
    fix the false positives (XCTAssertEqual, XCTAssertNotNil, etc.).
    """
    known_types = {t.name for f in result.files for t in f.types}
    for f in result.files:
        for fn in f.functions:
            for c in fn.calls:
                if c.kind == "initializer" and c.target not in known_types:
                    c.kind = "call"


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
    return _to_dict(result)


from dataclasses import asdict

def _to_dict(result: ParseResult) -> dict:
    return asdict(result)