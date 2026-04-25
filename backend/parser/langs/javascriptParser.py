from tree_sitter import Language, Parser
import tree_sitter_javascript
from ..base import BaseParser, FileResult, FunctionInfo, FunctionCall, TypeInfo, Param
from ..registry import register


# Function-like node types that we promote to FunctionInfo
_FUNC_DECLARATIONS = {
    "function_declaration",
    "generator_function_declaration",
}

# Nodes that wrap definitions (export, decoration, etc.) — we unwrap them
_WRAPPER_NODES = {
    "export_statement",
}


@register
class JavaScriptParser(BaseParser):

    def __init__(self):
        lang = Language(tree_sitter_javascript.language())
        self._parser = Parser(lang)

    @property
    def language(self) -> str:
        return "javascript"

    @property
    def extensions(self) -> list[str]:
        return [".js", ".mjs", ".cjs", ".jsx"]

    def parse_file(self, path: str) -> FileResult:
        with open(path, "rb") as f:
            source = f.read()
        tree = self._parser.parse(source)
        result = FileResult(path=path)
        self._walk(tree.root_node, source, result, current_class=None, current_fn=None)
        return result

    # ---- main walk ----

    def _walk(self, node, source, result, current_class, current_fn):
        # --- ESM imports: import ... from 'source' ---
        if node.type == "import_statement":
            mod = self._extract_import_source(node, source)
            if mod:
                result.imports.append(mod)
            return

        # --- export wrappers: unwrap to find class/function inside ---
        if node.type in _WRAPPER_NODES:
            for child in node.children:
                self._walk(child, source, result, current_class, current_fn)
            return

        # --- classes ---
        if node.type == "class_declaration":
            self._handle_class(node, source, result, current_class, current_fn)
            return

        # --- top-level / exported function declarations ---
        if node.type in _FUNC_DECLARATIONS:
            self._handle_function_declaration(node, source, result, current_class, current_fn)
            return

        # --- method_definition inside class_body ---
        if node.type == "method_definition" and current_class is not None:
            self._handle_method(node, source, result, current_class, current_fn)
            return

        # --- const foo = () => {} / const foo = function() {} ---
        if node.type == "lexical_declaration" or node.type == "variable_declaration":
            self._handle_variable_functions(node, source, result, current_class, current_fn)
            # also check for require() imports and walk other children
            self._handle_require_imports(node, source, result)
            return

        # --- call_expression ---
        if node.type == "call_expression" and current_fn is not None:
            call = self._extract_call(node, source)
            if call:
                current_fn.calls.append(call)
            for child in node.children:
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn)
            return

        # --- new_expression ---
        if node.type == "new_expression" and current_fn is not None:
            call = self._extract_new(node, source)
            if call:
                current_fn.calls.append(call)
            for child in node.children:
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn)
            return

        # --- default: recurse ---
        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=current_fn)

    # ---- text helper ----

    def _text(self, node, source: bytes) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8")

    # ---- imports ----

    def _extract_import_source(self, node, source) -> str | None:
        """Extract module source string from `import ... from 'module'`."""
        for child in node.children:
            if child.type == "string":
                return self._extract_string_content(child, source)
        return None

    def _extract_string_content(self, string_node, source) -> str | None:
        """Get the inner text of a string node (strip quotes)."""
        for child in string_node.children:
            if child.type == "string_fragment":
                return self._text(child, source)
        # fallback: strip outer quotes manually
        raw = self._text(string_node, source)
        if len(raw) >= 2 and raw[0] in ('"', "'", '`'):
            return raw[1:-1]
        return raw

    def _handle_require_imports(self, node, source, result):
        """Detect `const x = require('module')` and add to imports."""
        for child in node.children:
            if child.type == "variable_declarator":
                for sub in child.children:
                    if sub.type == "call_expression":
                        callee_name = None
                        for c in sub.children:
                            if c.type == "identifier":
                                callee_name = self._text(c, source)
                                break
                        if callee_name == "require":
                            for c in sub.children:
                                if c.type == "arguments":
                                    for arg in c.children:
                                        if arg.type == "string":
                                            mod = self._extract_string_content(arg, source)
                                            if mod:
                                                result.imports.append(mod)

    # ---- classes ----

    def _handle_class(self, node, source, result, current_class, current_fn):
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
        for child in node.children:
            self._walk(child, source, result, current_class=name, current_fn=None)

    def _extract_inherits(self, node, source) -> list[str]:
        out: list[str] = []
        for child in node.children:
            if child.type == "class_heritage":
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(self._text(sub, source))
                    elif sub.type == "member_expression":
                        out.append(self._text(sub, source))
        return out

    # ---- functions ----

    def _handle_function_declaration(self, node, source, result, current_class, current_fn):
        name = None
        for child in node.children:
            if child.type == "identifier":
                name = self._text(child, source)
                break
        if not name:
            return

        container = current_class or (current_fn.qualified_name if current_fn else None)
        qualified_name = f"{container}.{name}" if container else name

        fn = FunctionInfo(
            qualified_name=qualified_name,
            name=name,
            container=container,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature=self._extract_signature(node, source),
            params=self._extract_params(node, source),
            return_type=None,  # JS has no type annotations
        )
        result.functions.append(fn)
        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=fn)

    def _handle_method(self, node, source, result, current_class, current_fn):
        name = None
        for child in node.children:
            if child.type == "property_identifier":
                name = self._text(child, source)
                break
            if child.type == "private_property_identifier":
                name = self._text(child, source)
                break
        if not name:
            return

        qualified_name = f"{current_class}.{name}" if current_class else name

        fn = FunctionInfo(
            qualified_name=qualified_name,
            name=name,
            container=current_class,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature=self._extract_signature(node, source),
            params=self._extract_params(node, source),
            return_type=None,
        )
        result.functions.append(fn)
        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=fn)

    def _handle_variable_functions(self, node, source, result, current_class, current_fn):
        """Handle `const foo = () => {}` and `const foo = function() {}`."""
        for child in node.children:
            if child.type != "variable_declarator":
                continue
            var_name = None
            func_node = None
            for sub in child.children:
                if sub.type == "identifier" and var_name is None:
                    var_name = self._text(sub, source)
                elif sub.type in ("arrow_function", "function_expression",
                                  "generator_function"):
                    func_node = sub
            if var_name and func_node:
                container = current_class or (current_fn.qualified_name if current_fn else None)
                qualified_name = f"{container}.{var_name}" if container else var_name
                fn = FunctionInfo(
                    qualified_name=qualified_name,
                    name=var_name,
                    container=container,
                    line_start=func_node.start_point[0] + 1,
                    line_end=func_node.end_point[0] + 1,
                    signature=self._build_arrow_signature(var_name, func_node, source),
                    params=self._extract_params(func_node, source),
                    return_type=None,
                )
                result.functions.append(fn)
                for sub in func_node.children:
                    self._walk(sub, source, result, current_class=current_class, current_fn=fn)
            else:
                # not a function variable — walk children for any nested calls
                for sub in child.children:
                    self._walk(sub, source, result, current_class=current_class, current_fn=current_fn)

    # ---- signatures ----

    def _extract_signature(self, node, source) -> str:
        """Everything before the body block (statement_block)."""
        for child in node.children:
            if child.type == "statement_block":
                sig = source[node.start_byte:child.start_byte].decode("utf-8").rstrip()
                return sig
        return self._text(node, source).split("{")[0].strip()

    def _build_arrow_signature(self, name, func_node, source) -> str:
        """Build a readable signature for arrow / function expressions."""
        for child in func_node.children:
            if child.type in ("statement_block", "=>"):
                sig = source[func_node.start_byte:child.start_byte].decode("utf-8").rstrip()
                # prepend the variable name for clarity
                return f"const {name} = {sig}".rstrip()
        return f"const {name} = {self._text(func_node, source).split('{')[0].strip()}"

    # ---- params ----

    def _extract_params(self, node, source) -> list[Param]:
        params: list[Param] = []
        for child in node.children:
            if child.type == "formal_parameters":
                self._collect_params(child, source, params)
                break
        return params

    def _collect_params(self, params_node, source, out):
        for child in params_node.children:
            t = child.type
            if t == "identifier":
                out.append(Param(label=None, name=self._text(child, source), type=None))
            elif t == "assignment_pattern":
                # name = default
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(Param(label=None, name=self._text(sub, source), type=None))
                        break
            elif t == "rest_pattern":
                # ...args
                for sub in child.children:
                    if sub.type == "identifier":
                        out.append(Param(label=None, name=self._text(sub, source), type=None))
                        break
            elif t == "object_pattern" or t == "array_pattern":
                # destructured param — capture the full pattern text as the name
                out.append(Param(label=None, name=self._text(child, source), type=None))

    # ---- calls ----

    def _extract_call(self, node, source) -> FunctionCall | None:
        line = node.start_point[0] + 1
        for child in node.children:
            if child.type == "identifier":
                t = self._text(child, source)
                kind = "initializer" if t and t[0].isupper() else "call"
                return FunctionCall(target=t, line=line, receiver=None, method=t, kind=kind)
            if child.type == "member_expression":
                full = self._flatten_member(child, source)
                receiver, method = self._split_dotted(full)
                return FunctionCall(
                    target=full, line=line,
                    receiver=receiver, method=method, kind="method",
                )
        return None

    def _extract_new(self, node, source) -> FunctionCall | None:
        """Handle `new Foo(...)` → FunctionCall with kind='initializer'."""
        line = node.start_point[0] + 1
        for child in node.children:
            if child.type == "identifier":
                t = self._text(child, source)
                return FunctionCall(target=t, line=line, receiver=None, method=t, kind="initializer")
            if child.type == "member_expression":
                full = self._flatten_member(child, source)
                receiver, method = self._split_dotted(full)
                return FunctionCall(
                    target=full, line=line,
                    receiver=receiver, method=method, kind="initializer",
                )
        return None

    def _flatten_member(self, node, source) -> str:
        """Recursively flatten a member_expression into a dotted string."""
        parts: list[str] = []
        self._collect_member(node, source, parts)
        return "".join(parts)

    def _collect_member(self, node, source, parts):
        for child in node.children:
            t = child.type
            if t == "member_expression":
                self._collect_member(child, source, parts)
            elif t == "identifier":
                parts.append(self._text(child, source))
            elif t in ("property_identifier", "private_property_identifier"):
                parts.append(self._text(child, source))
            elif t == ".":
                parts.append(".")
            elif t == "this":
                parts.append("this")
            elif t == "super":
                parts.append("super")
            elif t == "call_expression":
                # chained: take callee, drop args
                parts.append(self._callee_text(child, source))
                parts.append("()")

    def _callee_text(self, call_node, source) -> str:
        for child in call_node.children:
            if child.type == "identifier":
                return self._text(child, source)
            if child.type == "member_expression":
                return self._flatten_member(child, source)
        return ""

    def _split_dotted(self, full: str) -> tuple[str | None, str]:
        if "." not in full:
            return None, full
        idx = full.rfind(".")
        return full[:idx], full[idx + 1:]