from tree_sitter import Language, Parser
import tree_sitter_python
from ..base import BaseParser, FileResult, FunctionInfo, FunctionCall, TypeInfo, Param
from ..registry import register


@register
class PythonParser(BaseParser):

    def __init__(self):
        lang = Language(tree_sitter_python.language())
        self._parser = Parser(lang)

    @property
    def language(self) -> str:
        return "python"

    @property
    def extensions(self) -> list[str]:
        return [".py"]

    def parse_file(self, path: str) -> FileResult:
        with open(path, "rb") as f:
            source = f.read()
        tree = self._parser.parse(source)
        result = FileResult(path=path)
        self._walk(tree.root_node, source, result, current_class=None, current_fn=None)
        return result

    # ---- main walk ----

    def _walk(self, node, source, result, current_class, current_fn):
        # --- imports ---
        if node.type == "import_statement":
            # import os  /  import os, sys
            for child in node.children:
                if child.type == "dotted_name":
                    result.imports.append(self._text(child, source))
            return

        if node.type == "import_from_statement":
            # from os.path import join  →  record "os.path"
            for child in node.children:
                if child.type == "dotted_name":
                    result.imports.append(self._text(child, source))
                    break  # only the module part (first dotted_name after 'from')
            return

        # --- decorated definitions (unwrap decorator to find class/function) ---
        if node.type == "decorated_definition":
            decorators = self._extract_decorators(node, source)
            for child in node.children:
                if child.type == "class_definition":
                    self._handle_class(child, source, result, current_class)
                elif child.type == "function_definition":
                    self._handle_function(
                        child, source, result, current_class, current_fn, decorators
                    )
            return

        # --- classes ---
        if node.type == "class_definition":
            self._handle_class(node, source, result, current_class)
            return

        # --- functions ---
        if node.type == "function_definition":
            self._handle_function(node, source, result, current_class, current_fn, decorators=[])
            return

        # --- calls ---
        if node.type == "call" and current_fn is not None:
            call = self._extract_call(node, source)
            if call:
                current_fn.calls.append(call)
            # recurse into children so chained / nested calls are also captured
            for child in node.children:
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn)
            return

        # --- default: recurse ---
        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=current_fn)

    # ---- text helper ----

    def _text(self, node, source: bytes) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8")

    # ---- decorators ----

    def _extract_decorators(self, decorated_node, source) -> list[str]:
        """Return list of decorator names (e.g. ['staticmethod', 'property'])."""
        out: list[str] = []
        for child in decorated_node.children:
            if child.type == "decorator":
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(self._text(sub, source))
                    elif sub.type == "attribute":
                        out.append(self._text(sub, source))
                    elif sub.type == "call":
                        # @decorator_with_args(...)  →  take callee name
                        for s in sub.children:
                            if s.type == "identifier":
                                out.append(self._text(s, source))
                                break
                            if s.type == "attribute":
                                out.append(self._text(s, source))
                                break
        return out

    # ---- classes ----

    def _handle_class(self, node, source, result, current_class):
        name = None
        for child in node.children:
            if child.type == "identifier":
                name = self._text(child, source)
                break
        if not name:
            return
        result.types.append(TypeInfo(
            name=name,
            kind="class",
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            inherits=self._extract_inherits(node, source),
        ))
        # walk children with this class as context
        for child in node.children:
            self._walk(child, source, result, current_class=name, current_fn=None)

    def _extract_inherits(self, node, source) -> list[str]:
        """Extract base class names from argument_list in class Foo(Base1, Base2)."""
        out: list[str] = []
        for child in node.children:
            if child.type == "argument_list":
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(self._text(sub, source))
                    elif sub.type == "attribute":
                        out.append(self._text(sub, source))
                    elif sub.type == "keyword_argument":
                        # metaclass=ABCMeta  →  skip, not a base class
                        pass
        return out

    # ---- functions ----

    def _handle_function(self, node, source, result, current_class, current_fn, decorators):
        name = None
        for child in node.children:
            if child.type == "identifier":
                name = self._text(child, source)
                break
        if not name:
            return

        container = current_class
        if current_fn is not None and current_class is None:
            # nested function inside a top-level function
            container = current_fn.qualified_name
        elif current_fn is not None and current_class is not None:
            # nested function inside a method
            container = current_fn.qualified_name

        qualified_name = f"{container}.{name}" if container else name

        is_staticmethod = "staticmethod" in decorators
        is_classmethod = "classmethod" in decorators

        fn = FunctionInfo(
            qualified_name=qualified_name,
            name=name,
            container=container,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature=self._extract_signature(node, source),
            params=self._extract_params(node, source, is_staticmethod, is_classmethod, current_class),
            return_type=self._extract_return_type(node, source),
        )
        fn.tags = [f"@{d}" for d in decorators]
        result.functions.append(fn)

        # walk body with this function as context
        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=fn)

    def _extract_signature(self, node, source) -> str:
        """Everything from 'def' up to (but not including) the body block + colon."""
        for child in node.children:
            if child.type == "block":
                sig = source[node.start_byte:child.start_byte].decode("utf-8")
                # strip trailing colon and whitespace
                sig = sig.rstrip()
                if sig.endswith(":"):
                    sig = sig[:-1].rstrip()
                return sig
        return self._text(node, source).split(":")[0].strip()

    def _extract_params(self, node, source, is_static, is_classmethod, current_class) -> list[Param]:
        params: list[Param] = []
        for child in node.children:
            if child.type == "parameters":
                self._collect_params(child, source, params)
                break

        # strip self / cls when inside a class
        if current_class and params:
            first_name = params[0].name
            if not is_static and first_name in ("self", "cls"):
                params = params[1:]

        return params

    def _collect_params(self, params_node, source, out):
        for child in params_node.children:
            t = child.type
            if t == "identifier":
                # plain param without annotation (e.g. self, x)
                out.append(Param(label=None, name=self._text(child, source), type=None))
            elif t == "typed_parameter":
                out.append(self._parse_typed_param(child, source))
            elif t == "typed_default_parameter":
                out.append(self._parse_typed_param(child, source))
            elif t == "default_parameter":
                # name=value, no annotation
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(Param(label=None, name=self._text(sub, source), type=None))
                        break
            elif t == "list_splat_pattern":
                # *args
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(Param(label=None, name=self._text(sub, source), type=None))
                        break
            elif t == "dictionary_splat_pattern":
                # **kwargs
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(Param(label=None, name=self._text(sub, source), type=None))
                        break

    def _parse_typed_param(self, node, source) -> Param:
        name = None
        type_str = None
        for child in node.children:
            if child.type == "identifier" and name is None:
                name = self._text(child, source)
            elif child.type == "type":
                type_str = self._text(child, source).strip()
        return Param(label=None, name=name or "", type=type_str)

    def _extract_return_type(self, node, source) -> str | None:
        kids = list(node.children)
        for i, child in enumerate(kids):
            if child.type == "->" and i + 1 < len(kids):
                nxt = kids[i + 1]
                if nxt.type == "type":
                    return self._text(nxt, source).strip()
        return None

    # ---- calls ----

    def _extract_call(self, node, source) -> FunctionCall | None:
        """Build a FunctionCall from a tree-sitter `call` node."""
        line = node.start_point[0] + 1

        for child in node.children:
            if child.type == "identifier":
                # bare call: foo() or Dog()
                t = self._text(child, source)
                kind = "initializer" if t and t[0].isupper() else "call"
                return FunctionCall(target=t, line=line, receiver=None, method=t, kind=kind)

            if child.type == "attribute":
                # method call: self.speak(), os.path.join(), super().speak()
                full = self._flatten_attr(child, source)
                receiver, method = self._split_dotted(full)
                return FunctionCall(
                    target=full, line=line,
                    receiver=receiver, method=method, kind="method",
                )
        return None

    def _flatten_attr(self, node, source) -> str:
        """Recursively flatten an `attribute` node into a dotted string.

        Handles chains like  super().speak  →  "super().speak"
                             df.groupby("x").mean()  →  "df.groupby().mean()"
        Actually we want the *callee* text without argument contents, mirroring
        the Swift parser's approach for navigation expressions.
        """
        parts: list[str] = []
        self._collect_attr(node, source, parts)
        return "".join(parts)

    def _collect_attr(self, node, source, parts):
        """Walk an `attribute` node depth-first, collecting text fragments."""
        for child in node.children:
            t = child.type
            if t == "attribute":
                self._collect_attr(child, source, parts)
            elif t == "identifier":
                parts.append(self._text(child, source))
            elif t == ".":
                parts.append(".")
            elif t == "call":
                # inner chained call — take callee, drop args
                parts.append(self._callee_text(child, source))
                parts.append("()")

    def _callee_text(self, call_node, source) -> str:
        """Extract just the callee name/chain from a call node (no args)."""
        for child in call_node.children:
            if child.type == "identifier":
                return self._text(child, source)
            if child.type == "attribute":
                return self._flatten_attr(child, source)
        return ""

    def _split_dotted(self, full: str) -> tuple[str | None, str]:
        if "." not in full:
            return None, full
        idx = full.rfind(".")
        return full[:idx], full[idx + 1:]