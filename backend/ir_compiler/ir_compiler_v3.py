import json
import math
import os
from collections import defaultdict, deque
from dataclasses import dataclass, field


# ═══════════════════════════════════════════════════════════════════════════════
# Type System
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class UnifiedType:
    """A single logical type, even if declared across class + N extensions."""
    name: str
    kind: str                          # "class" | "struct" | "enum" | "protocol" | "extension_only"
    inherits: list[str] = field(default_factory=list)
    protocols: list[str] = field(default_factory=list)
    methods: set[str] = field(default_factory=set)
    files: set[str] = field(default_factory=set)
    line_start: int | None = None
    line_end: int | None = None

    @property
    def is_protocol(self) -> bool:
        return self.kind == "protocol"

    @property
    def is_extension_only(self) -> bool:
        """True when the type appears only as extensions — i.e. an external type."""
        return self.kind == "extension_only"


class TypeRegistry:
    """
    Merges extensions into base types, tracks protocol conformance,
    and provides lookup queries for call resolution.
    """

    def __init__(self):
        self.types: dict[str, UnifiedType] = {}
        self._conformers: dict[str, list[str]] = {}
        self._ancestors_cache: dict[str, list[str]] = {}

    def build(self, ir: dict) -> None:
        raw_types: dict[str, list[dict]] = defaultdict(list)

        for file in ir["files"]:
            path = file["path"]
            for t in file.get("types", []):
                raw_types[t["name"]].append({**t, "_file": path})

        for name, declarations in raw_types.items():
            base = next((d for d in declarations if d["kind"] != "extension"), None)

            # ── BUG FIX 1: Extension-only types ──────────────────────────
            # If every declaration is an extension, the type is external
            # (e.g. XCTestCase, DispatchQueue, Promise).  Mark it as
            # "extension_only" so we don't create synthetic inits for it
            # or mis-classify its kind as "struct".
            if base is None:
                base = declarations[0]
                kind = "extension_only"
            else:
                kind = base["kind"]

            all_inherits = []
            seen_inherits = set()
            for d in declarations:
                for parent in d.get("inherits", []):
                    if parent not in seen_inherits:
                        seen_inherits.add(parent)
                        all_inherits.append(parent)

            files = {d["_file"] for d in declarations}

            self.types[name] = UnifiedType(
                name=name,
                kind=kind,
                inherits=all_inherits,
                files=files,
                line_start=base.get("line_start"),
                line_end=base.get("line_end"),
            )

        protocol_names = {n for n, t in self.types.items() if t.is_protocol}
        for utype in self.types.values():
            utype.protocols = [p for p in utype.inherits if p in protocol_names]

        conformers: dict[str, list[str]] = defaultdict(list)
        for utype in self.types.values():
            for proto in utype.protocols:
                conformers[proto].append(utype.name)
        self._conformers = dict(conformers)

        for file in ir["files"]:
            for fn in file["functions"]:
                container = fn.get("container")
                if container and container in self.types:
                    self.types[container].methods.add(fn["name"])

    def is_known_type(self, name: str) -> bool:
        return name in self.types

    def is_protocol(self, name: str) -> bool:
        t = self.types.get(name)
        return t is not None and t.is_protocol

    def get_conformers(self, protocol_name: str) -> list[str]:
        return self._conformers.get(protocol_name, [])

    def get_all_conformers(self, protocol_name: str) -> list[str]:
        result = set()
        queue = [protocol_name]
        visited = set()
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            for conformer in self._conformers.get(current, []):
                if self.is_protocol(conformer):
                    queue.append(conformer)
                else:
                    result.add(conformer)
        return list(result)

    def get_ancestors(self, type_name: str) -> list[str]:
        if type_name in self._ancestors_cache:
            return self._ancestors_cache[type_name]

        result = []
        visited = set()
        queue = list(self.types.get(type_name, UnifiedType(name=type_name, kind="unknown")).inherits)

        while queue:
            parent = queue.pop(0)
            if parent in visited:
                continue
            visited.add(parent)
            result.append(parent)
            parent_type = self.types.get(parent)
            if parent_type:
                queue.extend(parent_type.inherits)

        self._ancestors_cache[type_name] = result
        return result

    def get_concrete_ancestors(self, type_name: str) -> list[str]:
        """Like get_ancestors but skips protocols — for super dispatch."""
        return [
            a for a in self.get_ancestors(type_name)
            if not self.is_protocol(a)
        ]

    def has_method(self, type_name: str, method_name: str) -> bool:
        t = self.types.get(type_name)
        return t is not None and method_name in t.methods

    def case_insensitive_lookup(self, name: str) -> str | None:
        lower = name.lower()
        for t in self.types:
            if t.lower() == lower:
                return t
        return None

    def get_types_with_method(self, method_name: str) -> list[str]:
        return [name for name, utype in self.types.items() if method_name in utype.methods]

    def synthetic_init_types(self) -> set[str]:
        # ── BUG FIX 1 (continued): exclude extension-only types ──────
        # Extension-only types are external (Foundation, third-party).
        # Creating synthetic inits for them produces phantom nodes and
        # false edges (e.g. DispatchQueue() resolving to a local node).
        return {
            name for name, utype in self.types.items()
            if "init" not in utype.methods
            and not utype.is_protocol
            and not utype.is_extension_only
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Call Resolver
# ═══════════════════════════════════════════════════════════════════════════════

class CallResolver:
    """
    Resolves raw parser calls to graph node IDs.

    Strategies (in priority order):
      1. Initializers (explicit + synthetic for memberwise inits)
      2. self/super — three sub-cases in order:
         2a. Protocol container: fan out to all conforming implementations (witness dispatch)
         2b. Concrete container: exact self-method lookup, then ancestor chain
         2c. Protocol-conformance fallback for concrete containers
      3. Typed receiver (exact, case-insensitive, reverse lookup, protocol fan-out)
      4. Direct qualified name
      5. Unqualified match with file-affinity tiebreaking
    """

    def __init__(
        self,
        registry: TypeRegistry,
        qualified_to_ids: dict[str, list[str]],
        name_to_ids: dict[str, list[str]],
        method_to_qualified: dict[str, list[tuple[str, str]]],
    ):
        self.registry = registry
        self.qualified_to_ids = qualified_to_ids
        self.name_to_ids = name_to_ids
        self.method_to_qualified = method_to_qualified

    def resolve(
        self,
        call: dict,
        caller_container: str | None = None,
        caller_file: str | None = None,
        caller_node_id: str | None = None,
    ) -> list[str]:
        target = call.get("target", "")
        method = call.get("method", "")
        receiver = call.get("receiver")
        kind = call.get("kind", "call")

        if target.startswith("?"):
            return []

        if not method and target:
            method = target.rsplit(".", 1)[-1] if "." in target else target
        if not method:
            return []

        # Skip method-return-value chains: "store.dispatch.then" where the
        # receiver is itself a method call chain (3+ segments like a.b.c).
        # But allow property access patterns like "self.foo" or known-type
        # paths like "ObserverInterceptor.ObserverType".
        if receiver and "." in receiver:
            parts = receiver.split(".")
            first_seg = parts[0]
            if first_seg in ("self", "super"):
                pass
            elif self.registry.is_known_type(first_seg):
                pass
            elif len(parts) >= 3:
                return []
            else:
                pass

        # Strategy 1: Initializer
        if kind == "initializer":
            return self._resolve_initializer(method)

        # Strategy 2: self/super
        if receiver in ("self", "super") and caller_container:
            result = self._resolve_self_super(method, receiver, caller_container, caller_node_id)
            if result:
                return result
            result = self._resolve_via_protocol_conformance(method, caller_container)
            if result:
                return result

        # Strategy 3: Typed receiver
        if receiver and receiver not in ("self", "super"):
            result = self._resolve_typed_receiver(method, receiver, caller_file)
            if result:
                return result
            # If the receiver is a self.property or super.property access, we've
            # exhausted knowable resolution paths. Don't fall through to strategy 5:
            # a bare name-match there would be a false positive (e.g. a super.method()
            # where the superclass is external, matching the only local definition
            # of that name and producing a self-loop).
            recv_first = receiver.split(".")[0]
            if recv_first in ("self", "super") and "." in receiver:
                return []

        # Strategy 4: Direct qualified name
        if target:
            ids = self.qualified_to_ids.get(target)
            if ids:
                return [ids[0]]

        # Strategy 5: Unqualified match
        return self._resolve_unqualified(method, caller_file)

    def _resolve_initializer(self, type_name: str) -> list[str]:
        ids = self.qualified_to_ids.get(f"{type_name}.init")
        if ids:
            return [ids[0]]

        ids = self.qualified_to_ids.get(f"{type_name}.__synthetic_init")
        if ids:
            return [ids[0]]

        candidates = self.name_to_ids.get(type_name, [])
        if len(candidates) == 1:
            return [candidates[0]]

        return []

    def _resolve_self_super(
        self,
        method: str,
        receiver: str,
        caller_container: str,
        caller_node_id: str | None = None,
    ) -> list[str]:
        if receiver == "self":
            # 2a. Protocol container — self.method() is a witness dispatch call.
            # Looking up the protocol's own default impl would produce a self-loop;
            # instead fan out to every conforming type that implements the method.
            if self.registry.is_protocol(caller_container):
                return self._resolve_protocol_dispatch(caller_container, method)

            # 2b. Concrete container — try exact self-method first, then ancestors.
            ids = self.qualified_to_ids.get(f"{caller_container}.{method}")
            if ids:
                # When multiple overloads share the same qualified name, exclude
                # the calling node itself so a convenience init chain like
                # init() → init(interceptors:) doesn't collapse into a self-loop.
                candidates = [i for i in ids if i != caller_node_id] if caller_node_id else ids
                if candidates:
                    return [candidates[0]]

        # ── BUG FIX 3: super should only walk concrete ancestors ─────
        # In Swift, super.method() dispatches to the nearest concrete
        # superclass implementation, never to a protocol default.
        # For `self`, protocols in the ancestor chain can legitimately
        # provide a default implementation via the base class hierarchy,
        # so we keep the full chain for self.
        if receiver == "super":
            ancestors = self.registry.get_concrete_ancestors(caller_container)
        else:
            ancestors = self.registry.get_ancestors(caller_container)

        for ancestor in ancestors:
            ids = self.qualified_to_ids.get(f"{ancestor}.{method}")
            if ids:
                return [ids[0]]

        return []

    def _resolve_via_protocol_conformance(
        self, method: str, caller_container: str
    ) -> list[str]:
        utype = self.registry.types.get(caller_container)
        if not utype:
            return []

        for proto in utype.protocols:
            if self.registry.has_method(proto, method):
                ids = self.qualified_to_ids.get(f"{proto}.{method}")
                if ids:
                    return [ids[0]]

        return []

    def _resolve_typed_receiver(
        self, method: str, receiver: str, caller_file: str | None
    ) -> list[str]:
        first_seg = receiver.split(".")[0]

        # 3a. Exact type match
        if self.registry.is_known_type(first_seg):
            result = self._try_type_method(first_seg, method)
            if result:
                return result

            if self.registry.is_protocol(first_seg):
                return self._resolve_protocol_dispatch(first_seg, method)

            for ancestor in self.registry.get_ancestors(first_seg):
                result = self._try_type_method(ancestor, method)
                if result:
                    return result

        # Nested type path
        if "." in receiver:
            last_seg = receiver.rsplit(".", 1)[-1]
            if self.registry.is_known_type(last_seg):
                result = self._try_type_method(last_seg, method)
                if result:
                    return result

        # 3b. Case-insensitive match
        matched_type = self.registry.case_insensitive_lookup(first_seg)
        if matched_type:
            result = self._try_type_method(matched_type, method)
            if result:
                return result

            for ancestor in self.registry.get_ancestors(matched_type):
                result = self._try_type_method(ancestor, method)
                if result:
                    return result

        # 3c. Reverse lookup: find types that define this method uniquely.
        # For self.property.method() receivers (first_seg == "self"/"super"), the
        # property's concrete type is invisible to us, so most reverse-lookup hits
        # are false positives. We allow the single-match case only when the matched
        # type is a protocol — e.g. self.executor.executeAsync() correctly resolves
        # to Executor.executeAsync because any stored property typed as a protocol
        # is legitimately described by its protocol definition. Concrete-class hits
        # (e.g. TestableNotificationCenter.addObserver) are blocked as false positives.
        type_matches = self.method_to_qualified.get(method, [])

        # ── BUG FIX 2: multi-match with protocol in self.property case ──
        # When there are multiple matches AND the receiver is self.property,
        # check if any match is a protocol.  If exactly one is, use protocol
        # dispatch (it likely describes the stored property's abstract type).
        if first_seg in ("self", "super"):
            if len(type_matches) == 1:
                container_name, qname = type_matches[0]
                if self.registry.is_protocol(container_name):
                    ids = self.qualified_to_ids.get(qname)
                    if ids:
                        return [ids[0]]
                # block: concrete-class hit from a self.property receiver
            elif len(type_matches) > 1:
                # Partition into protocol vs concrete matches
                proto_matches = [
                    (c, q) for c, q in type_matches
                    if self.registry.is_protocol(c)
                ]
                if len(proto_matches) == 1:
                    # Exactly one protocol defines this method — fan out via
                    # protocol dispatch so we reach all conforming impls.
                    proto_name = proto_matches[0][0]
                    return self._resolve_protocol_dispatch(proto_name, method)
                # Multiple protocols or zero protocols — ambiguous, bail
        else:
            # Non-self/super receiver: original logic
            if len(type_matches) == 1:
                container_name, qname = type_matches[0]
                ids = self.qualified_to_ids.get(qname)
                if ids:
                    return [ids[0]]

            if len(type_matches) > 1:
                for container_name, qname in type_matches:
                    if first_seg.lower() in container_name.lower():
                        ids = self.qualified_to_ids.get(qname)
                        if ids:
                            return [ids[0]]

        return []

    def _try_type_method(self, type_name: str, method: str) -> list[str]:
        ids = self.qualified_to_ids.get(f"{type_name}.{method}")
        if ids:
            return [ids[0]]
        return []

    def _resolve_protocol_dispatch(self, protocol_name: str, method: str) -> list[str]:
        conformers = self.registry.get_all_conformers(protocol_name)
        results = []
        for conformer in conformers:
            ids = self.qualified_to_ids.get(f"{conformer}.{method}")
            if ids:
                results.append(ids[0])
        if not results:
            ids = self.qualified_to_ids.get(f"{protocol_name}.{method}")
            if ids:
                results.append(ids[0])
        return results

    def _resolve_unqualified(self, method: str, caller_file: str | None) -> list[str]:
        candidates = self.name_to_ids.get(method, [])

        if len(candidates) == 1:
            return [candidates[0]]

        if len(candidates) > 1 and caller_file:
            same_file = [
                c for c in candidates
                if c.split(":", 2)[1] == caller_file
            ]
            if len(same_file) == 1:
                return [same_file[0]]

        return []


# ═══════════════════════════════════════════════════════════════════════════════
# Node Enrichment Helpers  (Task 2)
# ═══════════════════════════════════════════════════════════════════════════════

_ACCESS_KEYWORDS = ("open", "public", "internal", "fileprivate", "private")


def _extract_access_level(signature: str) -> str:
    """
    Derive visibility from the signature text.  Swift's default is "internal",
    so only explicit keywords override it.
    """
    # Strip leading whitespace/newlines and check the first word
    sig = signature.lstrip()
    for kw in _ACCESS_KEYWORDS:
        # Match "public func", "private(set) var", etc.
        if sig.startswith(kw):
            # Ensure it's a full token (not "internalize")
            rest = sig[len(kw):]
            if not rest or not rest[0].isalpha():
                return kw
    return "internal"


def _is_override(signature: str) -> bool:
    """Check if the signature text contains the override keyword."""
    # "override" can appear after access level or attributes
    tokens = signature.split()
    return "override" in tokens


def _compute_protocol_witnesses(
    fn: dict,
    registry: TypeRegistry,
) -> list[str]:
    """
    Return a list of protocol names whose requirement this function satisfies.
    A function F on type T witnesses protocol P if:
      • T conforms (directly or transitively) to P, and
      • P has a method with the same name as F.
    """
    container = fn.get("container")
    if not container:
        return []
    utype = registry.types.get(container)
    if not utype:
        return []

    method_name = fn["name"]
    witnesses = []

    # Walk all protocols the type conforms to (direct + inherited via protocol chains)
    visited = set()
    queue = list(utype.protocols)
    while queue:
        proto = queue.pop(0)
        if proto in visited:
            continue
        visited.add(proto)
        ptype = registry.types.get(proto)
        if ptype and method_name in ptype.methods:
            witnesses.append(proto)
        # Also walk super-protocols
        if ptype:
            for parent in ptype.protocols:
                queue.append(parent)

    return witnesses


def _compute_complexity_proxy(fn: dict) -> dict:
    """
    Return a lightweight complexity estimate from available IR fields.

    • param_count  – arity of the function
    • call_count   – number of outbound call sites (correlates with logic)
    • line_span    – line_end - line_start + 1  (None if line_end is missing)
    """
    params = fn.get("params", [])
    calls = fn.get("calls", [])
    ls = fn.get("line_start")
    le = fn.get("line_end")
    line_span = (le - ls + 1) if (ls is not None and le is not None) else None

    return {
        "param_count": len(params),
        "call_count": len(calls),
        "line_span": line_span,
    }


def _compute_reachability(
    nodes: list[dict],
    edges: list[dict],
    seed_fn,
) -> set[str]:
    """
    BFS forward from every node where seed_fn(node) is True.
    Returns the set of reachable node IDs (including seeds).
    """
    adj: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        adj[e["source"]].append(e["target"])

    seeds = {n["id"] for n in nodes if seed_fn(n)}
    visited = set(seeds)
    queue = deque(seeds)

    while queue:
        current = queue.popleft()
        for neighbor in adj.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return visited


# ═══════════════════════════════════════════════════════════════════════════════
# Graph-Level Metadata  (Task 3)
# ═══════════════════════════════════════════════════════════════════════════════

def _compute_connected_components(nodes: list[dict], edges: list[dict]) -> list[list[str]]:
    """Undirected connected components via BFS."""
    adj: dict[str, set[str]] = defaultdict(set)
    for e in edges:
        adj[e["source"]].add(e["target"])
        adj[e["target"]].add(e["source"])

    visited = set()
    components = []

    for n in nodes:
        nid = n["id"]
        if nid in visited:
            continue
        comp = []
        queue = deque([nid])
        while queue:
            cur = queue.popleft()
            if cur in visited:
                continue
            visited.add(cur)
            comp.append(cur)
            for nb in adj.get(cur, []):
                if nb not in visited:
                    queue.append(nb)
        components.append(comp)

    components.sort(key=len, reverse=True)
    return components


def _tarjan_scc(nodes: list[dict], edges: list[dict]) -> list[list[str]]:
    """Tarjan's algorithm for strongly connected components."""
    adj: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        adj[e["source"]].append(e["target"])

    index_counter = [0]
    stack = []
    on_stack = set()
    lowlink = {}
    index = {}
    sccs = []

    node_ids = [n["id"] for n in nodes]

    def strongconnect(v):
        index[v] = lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)

        for w in adj.get(v, []):
            if w not in index:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index[w])

        if lowlink[v] == index[v]:
            scc = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                scc.append(w)
                if w == v:
                    break
            if len(scc) > 1:
                sccs.append(scc)

    for v in node_ids:
        if v not in index:
            strongconnect(v)

    sccs.sort(key=len, reverse=True)
    return sccs


def _build_graph_metadata(
    nodes: list[dict],
    edges: list[dict],
    registry: TypeRegistry,
    ir: dict,
) -> dict:
    """
    Compute rich graph-level statistics for the frontend overview panel.
    """
    # ── Per-kind counts (already existed in v3) ──
    kind_counts: dict[str, int] = defaultdict(int)
    for n in nodes:
        kind_counts[n["function_kind"]] += 1

    # ── Entry points: public/open + in_degree==0 ──
    entry_points = [
        n["id"] for n in nodes
        if n["in_degree"] == 0
        and n.get("access_level") in ("public", "open")
        and n["category"] == "source"
    ]

    # ── Connected components ──
    components = _compute_connected_components(nodes, edges)
    component_summary = {
        "count": len(components),
        "largest_size": len(components[0]) if components else 0,
        "isolated_nodes": sum(1 for c in components if len(c) == 1),
    }

    # ── Strongly connected components (cycles) ──
    sccs = _tarjan_scc(nodes, edges)
    cycle_summary = {
        "count": len(sccs),
        "largest_size": len(sccs[0]) if sccs else 0,
        "members": [scc for scc in sccs[:5]],  # top 5 for frontend display
    }

    # ── Test coverage proxy ──
    source_ids = {n["id"] for n in nodes if n["category"] == "source"}
    reachable_from_tests = _compute_reachability(
        nodes, edges,
        seed_fn=lambda n: n["category"] == "test",
    )
    covered_source = source_ids & reachable_from_tests
    test_coverage = {
        "source_nodes": len(source_ids),
        "covered_by_tests": len(covered_source),
        "coverage_ratio": round(len(covered_source) / max(len(source_ids), 1), 4),
    }

    # ── Protocol summary ──
    proto_summary = {}
    for name, utype in registry.types.items():
        if utype.is_protocol:
            conformers = registry.get_all_conformers(name)
            if conformers or utype.methods:
                proto_summary[name] = {
                    "conformer_count": len(conformers),
                    "method_count": len(utype.methods),
                }

    # ── Category breakdown ──
    cat_counts = defaultdict(int)
    for n in nodes:
        cat_counts[n["category"]] += 1

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "function_kinds": {
            kind: {
                "label": FUNCTION_KIND_LABELS.get(kind, kind),
                "count": kind_counts.get(kind, 0),
            }
            for kind in FUNCTION_KIND_LABELS
            if kind_counts.get(kind, 0) > 0
        },
        "category_counts": dict(cat_counts),
        "entry_points": entry_points,
        "connected_components": component_summary,
        "cycles": cycle_summary,
        "test_coverage": test_coverage,
        "protocol_summary": proto_summary,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Build Call Graph
# ═══════════════════════════════════════════════════════════════════════════════

def build_call_graph(ir: dict) -> dict:
    # Step 1: Build type registry (merges extensions, tracks protocols)
    registry = TypeRegistry()
    registry.build(ir)

    # Step 2: Create nodes from functions
    qualified_to_ids: dict[str, list[str]] = {}
    name_to_ids: dict[str, list[str]] = {}
    method_to_qualified: dict[str, list[tuple[str, str]]] = {}
    nodes: list[dict] = []
    raw_edges: list[tuple[str, dict, str | None, str]] = []

    for file in ir["files"]:
        path = file["path"]
        category = _get_category(path)

        for fn in file["functions"]:
            node_id = f"func:{path}:{fn['qualified_name']}:{fn['line_start']}"

            sig = fn["signature"]
            fk = _get_function_kind(fn, category, registry)

            node = {
                "id": node_id,
                "type": "function",
                "qualified_name": fn["qualified_name"],
                "name": fn["name"],
                "file": path,
                "line": fn["line_start"],
                "line_end": fn.get("line_end"),
                "signature": sig,
                "params": fn.get("params", []),
                "return_type": fn.get("return_type"),
                "container": fn.get("container"),
                "in_degree": 0,
                "out_degree": 0,
                "category": category,
                "function_kind": fk,
                # ── Task 2 enrichments ──
                "access_level": _extract_access_level(sig),
                "is_override": _is_override(sig),
                "protocol_witnesses": _compute_protocol_witnesses(fn, registry),
                "complexity": _compute_complexity_proxy(fn),
            }

            nodes.append(node)
            qualified_to_ids.setdefault(fn["qualified_name"], []).append(node_id)
            name_to_ids.setdefault(fn["name"], []).append(node_id)

            container = fn.get("container")
            if container:
                method_to_qualified.setdefault(fn["name"], []).append(
                    (container, fn["qualified_name"])
                )

            for call in fn["calls"]:
                raw_edges.append((node_id, call, container, path))

    # Step 3: Create synthetic init nodes for types without explicit init
    synthetic_types = registry.synthetic_init_types()
    for type_name in synthetic_types:
        utype = registry.types[type_name]
        first_file = next(iter(utype.files)) if utype.files else "unknown"
        qname = f"{type_name}.__synthetic_init"
        node_id = f"func:{first_file}:{qname}:0"

        node = {
            "id": node_id,
            "type": "function",
            "qualified_name": qname,
            "name": "init",
            "file": first_file,
            "line": utype.line_start or 0,
            "line_end": utype.line_end,
            "signature": f"{type_name}.init()",
            "params": [],
            "return_type": type_name,
            "container": type_name,
            "in_degree": 0,
            "out_degree": 0,
            "category": _get_category(first_file),
            "function_kind": "constructor",
            "synthetic": True,
            # enrichments for synthetic nodes
            "access_level": "internal",
            "is_override": False,
            "protocol_witnesses": [],
            "complexity": {"param_count": 0, "call_count": 0, "line_span": None},
        }
        nodes.append(node)
        qualified_to_ids.setdefault(qname, []).append(node_id)

    # Step 4: Resolve calls
    resolver = CallResolver(
        registry=registry,
        qualified_to_ids=qualified_to_ids,
        name_to_ids=name_to_ids,
        method_to_qualified=method_to_qualified,
    )

    edge_counts: dict[tuple[str, str], int] = {}
    for source_id, call, caller_container, caller_file in raw_edges:
        targets = resolver.resolve(
            call,
            caller_container=caller_container,
            caller_file=caller_file,
            caller_node_id=source_id,
        )
        for resolved_id in targets:
            # Suppress self-loops — a node calling itself is almost always an
            # artifact of overload ambiguity (e.g. super.method() when the
            # superclass is external) or a protocol default impl lookup hitting
            # its own node before being correctly fanned out.
            if resolved_id == source_id:
                continue
            key = (source_id, resolved_id)
            edge_counts[key] = edge_counts.get(key, 0) + 1

    edges = [
        {"source": src, "target": dst, "type": "calls", "weight": weight}
        for (src, dst), weight in edge_counts.items()
    ]

    # Step 5: Compute degrees
    node_map = {n["id"]: n for n in nodes}
    for edge in edges:
        node_map[edge["source"]]["out_degree"] += 1
        node_map[edge["target"]]["in_degree"] += 1

    # Step 6: Remove synthetic nodes that ended up with no edges
    connected_synthetic = set()
    for edge in edges:
        for nid in (edge["source"], edge["target"]):
            if node_map[nid].get("synthetic"):
                connected_synthetic.add(nid)

    nodes = [n for n in nodes if not n.get("synthetic") or n["id"] in connected_synthetic]

    # Step 7: Reachability enrichment — mark nodes reachable from public API
    reachable_from_public = _compute_reachability(
        nodes, edges,
        seed_fn=lambda n: (
            n.get("access_level") in ("public", "open")
            and n["category"] == "source"
        ),
    )
    for n in nodes:
        n["reachable_from_public_api"] = n["id"] in reachable_from_public

    # Step 8: Compute graph-level metadata
    metadata = _build_graph_metadata(nodes, edges, registry, ir)

    return {
        "graph_id": ir["repo"].split("/")[-1].replace("-swift", ""),
        "metadata": metadata,
        "nodes": nodes,
        "edges": edges,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Analysis
# ═══════════════════════════════════════════════════════════════════════════════

def get_node_with_neighbors(graph: dict, node_id: str) -> dict | None:
    node_map = {n["id"]: n for n in graph["nodes"]}

    if node_id not in node_map:
        return None

    callers = [
        node_map[e["source"]]
        for e in graph["edges"]
        if e["target"] == node_id and e["source"] in node_map
    ]
    callees = [
        node_map[e["target"]]
        for e in graph["edges"]
        if e["source"] == node_id and e["target"] in node_map
    ]

    return {
        "node": node_map[node_id],
        "callers": callers,
        "callees": callees,
    }


def predict_impact(graph: dict, node_id: str, max_distance: int = 4) -> list:
    node_map = {n["id"]: n for n in graph["nodes"]}

    if node_id not in node_map:
        return []

    outbound: dict[str, list[str]] = {}
    inbound: dict[str, list[str]] = {}
    edge_weight: dict[tuple[str, str], int] = {}

    for edge in graph["edges"]:
        src, dst = edge["source"], edge["target"]
        outbound.setdefault(src, []).append(dst)
        inbound.setdefault(dst, []).append(src)
        edge_weight[(src, dst)] = edge["weight"]

    visited = {node_id: {"distance": 0, "path": [node_id]}}
    queue = deque([node_id])

    while queue:
        current = queue.popleft()
        current_dist = visited[current]["distance"]

        if current_dist >= max_distance:
            continue

        neighbors = outbound.get(current, []) + inbound.get(current, [])
        for neighbor in neighbors:
            if neighbor not in visited:
                visited[neighbor] = {
                    "distance": current_dist + 1,
                    "path": visited[current]["path"] + [neighbor],
                }
                queue.append(neighbor)

    results = []
    for affected_id, info in visited.items():
        if affected_id == node_id:
            continue

        node = node_map.get(affected_id)
        if node is None:
            continue

        distance = info["distance"]
        path = info["path"]
        w = edge_weight.get(
            (path[-2], path[-1]),
            edge_weight.get((path[-1], path[-2]), 1),
        )
        in_deg = node["in_degree"]
        risk_score = (1.0 / (1 + distance)) * w * (1 + math.log(1 + in_deg))

        results.append({
            "id": affected_id,
            "distance": distance,
            "risk_score": round(risk_score, 4),
            "path": path,
        })

    results.sort(key=lambda x: x["risk_score"], reverse=True)
    return results[:30]


def hotspots(graph: dict, top_n: int = 10) -> list:
    """
    Improved hotspot detection (Task 4).

    Problems with naive in_degree ranking:
      • A node called 50× from one test file outranks a node called once from
        each of 10 different source files, even though the latter is more
        structurally central.
      • Test-only callers inflate in_degree without reflecting production risk.

    Improvements:
      1. Score by *unique source callers* rather than raw in_degree.
      2. Weight each caller by category: source callers count fully (1.0),
         test callers are discounted (0.25), util callers at (0.5).
      3. Break ties by out_degree (a hub that both receives and dispatches
         many calls is more critical).
    """
    node_map = {n["id"]: n for n in graph["nodes"]}

    # Build reverse adjacency with caller categories
    caller_map: dict[str, list[str]] = defaultdict(list)  # target -> [source_ids]
    for e in graph["edges"]:
        caller_map[e["target"]].append(e["source"])

    category_weight = {"source": 1.0, "util": 0.5, "test": 0.25}

    scored = []
    for n in graph["nodes"]:
        nid = n["id"]
        callers = caller_map.get(nid, [])
        # Unique callers weighted by category
        unique_callers = set(callers)
        weighted_score = sum(
            category_weight.get(node_map[c]["category"], 1.0)
            for c in unique_callers
            if c in node_map
        )
        scored.append({
            **n,
            "hotspot_score": round(weighted_score, 4),
            "unique_caller_count": len(unique_callers),
        })

    scored.sort(key=lambda x: (x["hotspot_score"], x["out_degree"]), reverse=True)
    return scored[:top_n]


def dead_code(graph: dict) -> list:
    """
    Improved dead-code detection (Task 4).

    Previous version returned nodes with in_degree == 0 (excluding test,
    constructor, synthetic).  Problems:
      • A node called only by other dead nodes is also dead (transitively).
      • Public API entry points with in_degree 0 are NOT dead — they are
        the intended surface.  Exclude public/open nodes.

    Algorithm:
      1. Seed: all non-test, non-constructor, non-synthetic, non-public
         source/util nodes with in_degree == 0.
      2. Iteratively prune: if removing a dead node drops another node's
         *effective* in_degree to 0 (considering only live callers), that
         node is also dead.
    """
    node_map = {n["id"]: n for n in graph["nodes"]}

    # Build reverse adjacency: target → set of source IDs
    callers_of: dict[str, set[str]] = defaultdict(set)
    for e in graph["edges"]:
        callers_of[e["target"]].add(e["source"])

    def _is_candidate(n: dict) -> bool:
        """Could this node ever be classified as dead?"""
        if n["category"] == "test":
            return False
        if n["function_kind"] == "constructor":
            return False
        if n.get("synthetic", False):
            return False
        # Public API entry points are by definition alive
        if n.get("access_level") in ("public", "open"):
            return False
        return True

    candidates = {n["id"] for n in graph["nodes"] if _is_candidate(n)}

    # Seed: candidates with no callers at all
    dead_ids: set[str] = set()
    for nid in candidates:
        if not callers_of.get(nid):
            dead_ids.add(nid)

    # Transitive pruning
    changed = True
    while changed:
        changed = False
        for nid in candidates - dead_ids:
            live_callers = callers_of.get(nid, set()) - dead_ids
            if not live_callers:
                dead_ids.add(nid)
                changed = True

    return [node_map[nid] for nid in dead_ids if nid in node_map]


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers & Save
# ═══════════════════════════════════════════════════════════════════════════════

def _get_category(path: str) -> str:
    if "/Tests/" in path or "Tests/" in path:
        return "test"
    if "/Helpers/" in path or "/Util/" in path:
        return "util"
    return "source"


# Canonical display order + human labels for the frontend filter panel.
FUNCTION_KIND_LABELS: dict[str, str] = {
    "constructor":      "Constructors",
    "destructor":       "Destructors",
    "protocol_default": "Protocol defaults",
    "static_method":    "Static / class methods",
    "test_case":        "Test cases",
    "test_lifecycle":   "Test lifecycle (setUp / tearDown)",
    "test_helper":      "Test helpers",
    "method":           "Methods",
}

_TEST_LIFECYCLE_NAMES = {
    "setUp", "setUpWithError",
    "tearDown", "tearDownWithError",
}


def _get_function_kind(fn: dict, category: str, registry: "TypeRegistry") -> str:
    """
    Classify a parsed function node into one of the FUNCTION_KIND_LABELS keys.

    Priority order matters:
      • A test init() is still a constructor, not a test_case.
      • A protocol init() is still a constructor, not a protocol_default.
      • A static helper in a test file is test_helper, not static_method.
    """
    name      = fn["name"]
    sig       = fn.get("signature", "")
    container = fn.get("container")

    # 1. Language-level lifecycle — highest priority, unambiguous
    if name == "init":
        return "constructor"
    if name == "deinit":
        return "destructor"

    # 2. Test-file functions, sub-classified so a setUp in a test file
    #    isn't miscategorised as a generic "method"
    if category == "test":
        if name.startswith("test"):
            return "test_case"
        if name in _TEST_LIFECYCLE_NAMES:
            return "test_lifecycle"
        return "test_helper"

    # 3. Protocol default implementations — any function whose container is
    #    a protocol must be a default impl declared in a protocol extension;
    #    bare protocol requirements without bodies are not emitted by the parser
    if container and registry.is_protocol(container):
        return "protocol_default"

    # 4. Static / class methods — inferred from the signature text because
    #    the parser doesn't yet expose a dedicated flag for this
    if "static func" in sig or "class func" in sig:
        return "static_method"

    # 5. Regular instance method
    return "method"


def save_graph(graph: dict, path: str = "backend/cached/katana.graph.json") -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(graph, f, indent=2)
    print(f"Saved → {path} ({len(graph['nodes'])} nodes, {len(graph['edges'])} edges)")


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    ir_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), "..", "tests", "parser_tests", "output.json"
    )
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), "..", "tests", "ir_compiler_tests", "graph_output.json"
    )

    with open(ir_path) as f:
        ir = json.load(f)

    graph = build_call_graph(ir)
    save_graph(graph, out_path)