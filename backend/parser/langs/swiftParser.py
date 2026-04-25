from tree_sitter import Language, Parser
import tree_sitter_swift
from ..base import BaseParser, FileResult, FunctionInfo, FunctionCall, TypeInfo, Param
from ..registry import register

CONTAINER_TYPES = {
    "class_declaration",
    "protocol_declaration",
}

KEYWORD_TO_KIND = {
    "class": "class",
    "struct": "struct",
    "actor": "class",
    "enum": "enum",
    "protocol": "protocol",
    "extension": "extension",
}

@register
class SwiftParser(BaseParser):

    def __init__(self):
        lang = Language(tree_sitter_swift.language())
        self._parser = Parser(lang)

    @property
    def language(self) -> str:
        return "swift"

    @property
    def extensions(self) -> list[str]:
        return [".swift"]

    def parse_file(self, path: str) -> FileResult:
        with open(path, "rb") as f:
            source = f.read()
        tree = self._parser.parse(source)
        result = FileResult(path=path)
        self._walk(tree.root_node, source, result, current_class=None, current_fn=None, branch_stack=[])
        self._synthesize_default_inits(result)
        return result

    def _synthesize_default_inits(self, result: FileResult) -> None:
        """Swift gives every struct/class a memberwise/default init even when
        none is written. Add a stub FunctionInfo for each type without an
        explicit init so calls like `AdoptionError(message: "x")` resolve."""
        explicit = {fn.container for fn in result.functions if fn.name == "init" and fn.container}
        for t in result.types:
            if t.kind not in ("class", "struct"):
                continue
            if t.name in explicit:
                continue
            result.functions.append(FunctionInfo(
                qualified_name=f"{t.name}.init",
                name="init",
                container=t.name,
                line_start=t.line_start,
                line_end=t.line_start,
                signature=f"init  // synthesized default init for {t.kind} {t.name}",
                params=[],
                return_type=t.name,
            ))

    # ---- main walk ----

    def _walk(self, node, source, result, current_class, current_fn, branch_stack):
        if node.type == "import_declaration":
            for child in node.children:
                if child.type == "identifier":
                    # Take the full dotted path (e.g. "os.signpost") as a single import,
                    # not each simple_identifier component separately.
                    result.imports.append(self._text(child, source).strip())
            return

        if node.type in CONTAINER_TYPES:
            kind = self._extract_kind(node)
            name = self._extract_container_name(node, source)
            if name:
                result.types.append(TypeInfo(
                    name=name,
                    kind=kind,
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    inherits=self._extract_inherits(node, source),
                ))
            for child in node.children:
                self._walk(child, source, result, current_class=name, current_fn=None, branch_stack=[])
            return

        if node.type == "function_declaration":
            fn = self._extract_function(node, source, current_class)
            if fn:
                result.functions.append(fn)
                for child in node.children:
                    self._walk(child, source, result, current_class=current_class, current_fn=fn, branch_stack=[])
            return

        if node.type == "init_declaration":
            fn = self._extract_init(node, source, current_class)
            if fn:
                result.functions.append(fn)
                for child in node.children:
                    self._walk(child, source, result, current_class=current_class, current_fn=fn, branch_stack=[])
            return

        if node.type == "deinit_declaration":
            fn = self._extract_deinit(node, source, current_class)
            if fn:
                result.functions.append(fn)
                for child in node.children:
                    self._walk(child, source, result, current_class=current_class, current_fn=fn, branch_stack=[])
            return

        if node.type == "if_statement" and current_fn:
            self._walk_if(node, source, result, current_class, current_fn, branch_stack)
            return

        if node.type == "guard_statement" and current_fn:
            self._walk_guard(node, source, result, current_class, current_fn, branch_stack)
            return

        if node.type == "switch_statement" and current_fn:
            self._walk_switch(node, source, result, current_class, current_fn, branch_stack)
            return

        if node.type == "call_expression" and current_fn:
            call = self._extract_call(node, source)
            if call:
                if branch_stack:
                    cond, kind = branch_stack[-1]
                    call.condition = cond
                    call.branch_kind = kind
                current_fn.calls.append(call)
            # Walk every child so we recurse into:
            #   - the callee subtree (for chained inner calls like a.b().c())
            #   - argument subtrees (for calls inside non-closure args like dispatch(Foo()))
            #   - closure bodies inside arguments
            # Inner call_expression nodes have distinct byte ranges from this one,
            # so re-entering this branch won't double-count the outer call.
            for child in node.children:
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=branch_stack)
            return

        for child in node.children:
            self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=branch_stack)

    # ---- branch handlers ----

    def _walk_if(self, node, source, result, current_class, current_fn, branch_stack):
        children = list(node.children)
        cond_text = self._slice_between(children, source, "if", "{")
        then_stack = branch_stack + [(cond_text, "if_then")]

        # Phases: 0 = before '{', 1 = then-body, 2 = else region
        phase = 0
        else_consumed_keyword = False
        for child in children:
            t = child.type
            if phase == 0:
                if t == "if":
                    continue
                if t == "{":
                    phase = 1
                    continue
                # condition expression — uses outer stack
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=branch_stack)
            elif phase == 1:
                if t == "}":
                    phase = 2
                    continue
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=then_stack)
            else:  # phase 2: else region
                if t == "else":
                    else_consumed_keyword = True
                    continue
                if not else_consumed_keyword:
                    continue
                if t == "if_statement":
                    # else-if: innermost wins via stack ordering
                    else_stack = branch_stack + [("else", "if_else")]
                    self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=else_stack)
                elif t == "{" or t == "}":
                    continue
                else:
                    else_stack = branch_stack + [("else", "if_else")]
                    self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=else_stack)

    def _walk_guard(self, node, source, result, current_class, current_fn, branch_stack):
        children = list(node.children)
        cond_text = self._slice_between(children, source, "guard", "else")
        else_stack = branch_stack + [(cond_text, "guard_else")]

        phase = 0  # 0 = condition, 1 = else body
        for child in children:
            t = child.type
            if phase == 0:
                if t == "guard":
                    continue
                if t == "else":
                    phase = 1
                    continue
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=branch_stack)
            else:
                if t == "{" or t == "}":
                    continue
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=else_stack)

    def _walk_switch(self, node, source, result, current_class, current_fn, branch_stack):
        seen_open = False
        for child in node.children:
            t = child.type
            if t == "switch":
                continue
            if t == "{":
                seen_open = True
                continue
            if t == "}":
                continue
            if not seen_open:
                # subject expression — outer stack
                self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=branch_stack)
            elif t == "switch_entry":
                self._walk_switch_entry(child, source, result, current_class, current_fn, branch_stack)

    def _walk_switch_entry(self, node, source, result, current_class, current_fn, branch_stack):
        label = self._extract_switch_entry_label(node, source)
        case_stack = branch_stack + [(label, "switch_case")]
        seen_colon = False
        for child in node.children:
            if not seen_colon:
                if child.type == ":":
                    seen_colon = True
                continue
            self._walk(child, source, result, current_class=current_class, current_fn=current_fn, branch_stack=case_stack)

    def _extract_switch_entry_label(self, node, source) -> str:
        parts = []
        is_default = False
        seen_keyword = False
        for child in node.children:
            t = child.type
            if t == "case":
                seen_keyword = True
                continue
            if t == "default_keyword":
                is_default = True
                seen_keyword = True
                continue
            if t == ":":
                break
            if seen_keyword and t != ",":
                txt = self._text(child, source).strip()
                if txt:
                    parts.append(txt)
        if is_default:
            return "default"
        return ("case " + ", ".join(parts)).strip()

    def _slice_between(self, children, source, start_type: str, end_type: str) -> str:
        start = None
        end = None
        for child in children:
            if start is None and child.type == start_type:
                start = child.end_byte
                continue
            if start is not None and child.type == end_type:
                end = child.start_byte
                break
        if start is None or end is None:
            return ""
        return " ".join(source[start:end].decode("utf-8").split())

    # ---- text helper ----

    def _text(self, node, source: bytes) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8")

    # ---- types ----

    def _extract_container_name(self, node, source) -> str | None:
        for child in node.children:
            if child.type == "user_type":
                for sub in child.children:
                    if sub.type == "type_identifier":
                        return self._text(sub, source)
                return self._text(child, source)
            if child.type in ("type_identifier", "simple_identifier"):
                return self._text(child, source)
        return None

    def _extract_inherits(self, node, source) -> list[str]:
        out = []
        for child in node.children:
            if child.type in ("inheritance_specifier", "type_inheritance_clause"):
                self._collect_type_idents(child, source, out)
        return out

    def _collect_type_idents(self, node, source, out):
        for child in node.children:
            if child.type == "type_identifier":
                out.append(self._text(child, source))
            elif child.type == "user_type":
                for sub in child.children:
                    if sub.type == "type_identifier":
                        out.append(self._text(sub, source))
                        break
            else:
                self._collect_type_idents(child, source, out)

    # ---- functions ----

    def _extract_function(self, node, source, current_class) -> FunctionInfo | None:
        name = None
        for child in node.children:
            if child.type == "simple_identifier":
                name = self._text(child, source)
                break
        if not name:
            return None
        qualified_name = f"{current_class}.{name}" if current_class else name
        return FunctionInfo(
            qualified_name=qualified_name,
            name=name,
            container=current_class,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature=self._extract_signature(node, source),
            params=self._extract_params(node, source),
            return_type=self._extract_return_type(node, source),
        )

    def _extract_init(self, node, source, current_class) -> FunctionInfo | None:
        return FunctionInfo(
            qualified_name=f"{current_class}.init" if current_class else "init",
            name="init",
            container=current_class,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature=self._extract_signature(node, source),
            params=self._extract_params(node, source),
            return_type=current_class,  # init returns its containing type
        )

    def _extract_deinit(self, node, source, current_class) -> FunctionInfo | None:
        return FunctionInfo(
            qualified_name=f"{current_class}.deinit" if current_class else "deinit",
            name="deinit",
            container=current_class,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            signature="deinit",
        )

    def _extract_signature(self, node, source) -> str:
        for child in node.children:
            if child.type == "function_body":
                return source[node.start_byte:child.start_byte].decode("utf-8").strip()
        return self._text(node, source).split("{")[0].strip()

    def _extract_params(self, node, source) -> list[Param]:
        params = []
        for child in node.children:
            if child.type == "parameter":
                params.append(self._parse_param(child, source))
        return params

    def _parse_param(self, node, source) -> Param:
        idents: list[str] = []
        type_str: str | None = None

        TYPE_NODES = {
            "user_type", "type_identifier",
            "optional_type", "array_type", "dictionary_type",
            "function_type", "tuple_type",
        }

        for child in node.children:
            t = child.type
            if t == "simple_identifier":
                idents.append(self._text(child, source))
            elif t in TYPE_NODES and type_str is None:
                type_str = self._text(child, source).strip()

        if len(idents) >= 2:
            ext, internal = idents[0], idents[1]
            label = None if ext == "_" else ext
            name = internal
        elif idents:
            ident = idents[0]
            label = None if ident == "_" else ident
            name = ident
        else:
            label = None
            name = ""

        return Param(label=label, name=name, type=type_str)

    def _extract_return_type(self, node, source) -> str | None:
        kids = list(node.children)
        for i, child in enumerate(kids):
            if child.type == "->" and i + 1 < len(kids):
                nxt = kids[i + 1]
                if nxt.type != "function_body":
                    return self._text(nxt, source).strip()
        return None

    # ---- calls ----

    def _is_subscript(self, node) -> bool:
        """Return True if this call_expression is actually a subscript (e.g. store[key])."""
        for child in node.children:
            if child.type == "call_suffix":
                for sub in child.children:
                    if sub.type == "value_arguments":
                        for tok in sub.children:
                            if tok.type == "[":
                                return True
        return False

    def _extract_call(self, node, source) -> FunctionCall | None:
        if self._is_subscript(node):
            return None
        line = node.start_point[0] + 1
        for child in node.children:
            if child.type == "simple_identifier":
                t = self._text(child, source)
                # PascalCase bare call is *probably* an initializer; resolver
                # can override using the types table (e.g. XCTAssertEqual is not).
                kind = "initializer" if t and t[0].isupper() else "call"
                return FunctionCall(target=t, line=line, receiver=None, method=t, kind=kind)
            if child.type == "navigation_expression":
                full = self._navigation_text(child, source)
                receiver, method = self._split_navigation(full)
                return FunctionCall(target=full, line=line,
                                    receiver=receiver, method=method, kind="method")
        return None

    def _navigation_text(self, node, source) -> str:
        parts: list[str] = []
        self._collect_nav(node, source, parts)
        # Strip all whitespace — handles chains across lines cleanly
        return "".join("".join(p.split()) for p in parts)

    def _collect_nav(self, node, source, parts):
        for child in node.children:
            t = child.type
            if t == "navigation_expression":
                self._collect_nav(child, source, parts)
            elif t == "call_expression":
                # take callee, drop args
                parts.append(self._callee_text(child, source))
            elif t in ("simple_identifier", "type_identifier",
                       "self_expression", "super_expression",
                       "navigation_suffix"):
                parts.append(self._text(child, source))
            elif t == ".":
                parts.append(".")

    def _callee_text(self, call_node, source) -> str:
        for child in call_node.children:
            if child.type == "simple_identifier":
                return self._text(child, source)
            if child.type == "navigation_expression":
                return self._navigation_text(child, source)
        return ""

    def _split_navigation(self, full: str) -> tuple[str | None, str]:
        if "." not in full:
            return None, full
        idx = full.rfind(".")
        return full[:idx], full[idx + 1:]
    
    def _extract_kind(self, node) -> str:
        for child in node.children:
            if child.type in KEYWORD_TO_KIND:
                return KEYWORD_TO_KIND[child.type]
        # fallback ako node.type sam nosi info (protocol_declaration)
        if node.type == "protocol_declaration":
            return "protocol"
        return "class"