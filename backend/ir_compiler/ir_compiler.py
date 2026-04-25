import json
import math
from collections import deque


# ─── Build Call Graph ─────────────────────────────────────────────────────────

def build_call_graph(ir: dict) -> dict:
    qualified_to_ids = {}   # qualified_name -> [node_id, ...] (handles overloads)
    name_to_ids = {}
    nodes = []
    raw_edges = []

    # Build a set of known type names from the `types` field for better resolution
    known_types = set()
    inherits_map = {}       # type_name -> [parent_type_names]
    for file in ir["files"]:
        for t in file.get("types", []):
            known_types.add(t["name"])
            inherits_map[t["name"]] = t.get("inherits", [])

    # Case-insensitive type lookup: "store" -> "Store"
    type_name_lower = {}
    for t in known_types:
        type_name_lower[t.lower()] = t

    # Reverse lookup: method_name -> [qualified_names that contain it]
    # Built after first pass over functions
    method_to_qualified = {}

    for file in ir["files"]:
        path = file["path"]
        category = _get_category(path)

        for fn in file["functions"]:
            node_id = f"func:{path}:{fn['qualified_name']}:{fn['line_start']}"

            node = {
                "id": node_id,
                "type": "function",
                "qualified_name": fn["qualified_name"],
                "name": fn["name"],
                "file": path,
                "line": fn["line_start"],
                "line_end": fn.get("line_end"),
                "signature": fn["signature"],
                "params": fn.get("params", []),
                "return_type": fn.get("return_type"),
                "container": fn.get("container"),
                "in_degree": 0,
                "out_degree": 0,
                "category": category,
            }

            nodes.append(node)
            qualified_to_ids.setdefault(fn["qualified_name"], []).append(node_id)

            name = fn["name"]
            name_to_ids.setdefault(name, []).append(node_id)

            # Build reverse lookup: method -> [(container, qualified_name)]
            container = fn.get("container")
            if container:
                method_to_qualified.setdefault(name, []).append(
                    (container, fn["qualified_name"])
                )

            for call in fn["calls"]:
                raw_edges.append((node_id, call, fn.get("container"), path))

    edge_counts = {}
    for source_id, call, caller_container, caller_file in raw_edges:
        resolved_id = _resolve_call(
            call, qualified_to_ids, name_to_ids,
            known_types=known_types,
            caller_container=caller_container,
            inherits_map=inherits_map,
            type_name_lower=type_name_lower,
            method_to_qualified=method_to_qualified,
            caller_file=caller_file,
        )
        if resolved_id is None:
            continue

        key = (source_id, resolved_id)
        edge_counts[key] = edge_counts.get(key, 0) + 1

    edges = [
        {"source": src, "target": dst, "type": "calls", "weight": weight}
        for (src, dst), weight in edge_counts.items()
    ]

    node_map = {n["id"]: n for n in nodes}
    for edge in edges:
        node_map[edge["source"]]["out_degree"] += 1
        node_map[edge["target"]]["in_degree"] += 1

    return {
        "graph_id": ir["repo"].split("/")[-1].replace("-swift", ""),
        "nodes": nodes,
        "edges": edges,
    }


# ─── Call Resolution ──────────────────────────────────────────────────────────

def _resolve_call(
    call: dict,
    qualified_to_ids: dict,
    name_to_ids: dict,
    *,
    known_types: set | None = None,
    caller_container: str | None = None,
    inherits_map: dict | None = None,
    type_name_lower: dict | None = None,
    method_to_qualified: dict | None = None,
    caller_file: str | None = None,
) -> str | None:
    target = call.get("target", "")
    method = call.get("method", "")
    receiver = call.get("receiver")
    kind = call.get("kind", "call")

    if known_types is None:
        known_types = set()
    if inherits_map is None:
        inherits_map = {}
    if type_name_lower is None:
        type_name_lower = {}
    if method_to_qualified is None:
        method_to_qualified = {}

    # Always skip unresolved markers
    if target.startswith("?"):
        return None

    # Old format fallback: if no method field, derive from target
    if not method and target:
        method = target.split(".")[-1] if "." in target else target

    if not method:
        return None

    # Helper: pick first match from qualified_to_ids (handles overloads)
    def _first(qname: str) -> str | None:
        ids = qualified_to_ids.get(qname)
        return ids[0] if ids else None

    # Helper: pick best candidate with file affinity
    def _best_of(candidates: list) -> str | None:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        if caller_file:
            for c in candidates:
                # node_id = func:<file>:<qname>:<line>
                parts = c.split(":", 2)
                if len(parts) >= 2 and parts[1] == caller_file:
                    return c
        return candidates[0]

    # 1. Initializers: try "Method.init" qualified name
    if kind == "initializer":
        resolved = _first(f"{method}.init")
        if resolved:
            return resolved
        candidates = name_to_ids.get(method, [])
        if len(candidates) == 1:
            return candidates[0]
        return None

    # 2. self/super + container-based resolution
    if receiver in ("self", "super") and caller_container:
        # For "self", try own container first; for "super", skip to parents
        if receiver == "self":
            resolved = _first(f"{caller_container}.{method}")
            if resolved:
                return resolved

        # Walk inheritance chain (for both self and super)
        for parent in _get_ancestors(caller_container, inherits_map):
            resolved = _first(f"{parent}.{method}")
            if resolved:
                return resolved

    # 3. Known type receiver (exact match)
    if receiver and receiver not in ("self", "super"):
        first_seg = receiver.split(".")[0]

        # 3a. Exact type match (uppercase or in known_types)
        if first_seg in known_types or (first_seg and first_seg[0].isupper()):
            resolved = _first(f"{receiver}.{method}")
            if resolved:
                return resolved
            # For nested types like "ObserverInterceptor.ObserverType",
            # try just the last segment as the type
            if "." in receiver:
                last_seg = receiver.rsplit(".", 1)[-1]
                resolved = _first(f"{last_seg}.{method}")
                if resolved:
                    return resolved

        # 3b. Case-insensitive receiver → type match
        #     "store" → "Store", "signpostLogger" → "SignpostLogger"
        matched_type = type_name_lower.get(first_seg.lower())
        if matched_type:
            resolved = _first(f"{matched_type}.{method}")
            if resolved:
                return resolved

        # 3c. Reverse lookup: find any type that defines this method
        #     For receivers like "context", "logic", "item" where
        #     case-insensitive doesn't match but a type has the method
        type_matches = method_to_qualified.get(method, [])
        if len(type_matches) == 1:
            _, qname = type_matches[0]
            resolved = _first(qname)
            if resolved:
                return resolved
        elif len(type_matches) > 1:
            # Multiple types have this method — try to narrow by receiver name
            # e.g. receiver "logic" might hint at "ObserverLogic"
            for container_name, qname in type_matches:
                if first_seg.lower() in container_name.lower():
                    resolved = _first(qname)
                    if resolved:
                        return resolved

    # 4. Try the full target string as a qualified name directly
    if target:
        resolved = _first(target)
        if resolved:
            return resolved

    # 5. Unqualified match — unique or file-affinity
    candidates = name_to_ids.get(method, [])
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1 and caller_file:
        # Prefer candidate in the same file
        same_file = [c for c in candidates if c.split(":", 2)[1] == caller_file]
        if len(same_file) == 1:
            return same_file[0]

    return None


def _get_ancestors(type_name: str, inherits_map: dict, _seen: set | None = None) -> list:
    """Walk the inheritance chain, return all ancestor type names (BFS)."""
    if _seen is None:
        _seen = set()
    result = []
    parents = inherits_map.get(type_name, [])
    for p in parents:
        if p not in _seen:
            _seen.add(p)
            result.append(p)
            result.extend(_get_ancestors(p, inherits_map, _seen))
    return result


# ─── Get Node With Neighbors ──────────────────────────────────────────────────

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


# ─── Predict Impact ───────────────────────────────────────────────────────────

def predict_impact(graph: dict, node_id: str) -> list:
    node_map = {n["id"]: n for n in graph["nodes"]}

    if node_id not in node_map:
        return []

    outbound = {}
    inbound = {}
    edge_weight = {}

    for edge in graph["edges"]:
        src, dst = edge["source"], edge["target"]
        outbound.setdefault(src, []).append(dst)
        inbound.setdefault(dst, []).append(src)
        edge_weight[(src, dst)] = edge["weight"]

    visited = {node_id: {"distance": 0, "path": [node_id]}}
    queue = deque([node_id])
    MAX_DISTANCE = 4

    while queue:
        current = queue.popleft()
        current_dist = visited[current]["distance"]

        if current_dist >= MAX_DISTANCE:
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
            edge_weight.get((path[-1], path[-2]), 1)
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


# ─── Hotspots ─────────────────────────────────────────────────────────────────

def hotspots(graph: dict, top_n: int = 10) -> list:
    sorted_nodes = sorted(graph["nodes"], key=lambda n: n["in_degree"], reverse=True)
    return sorted_nodes[:top_n]


# ─── Dead Code ────────────────────────────────────────────────────────────────

def dead_code(graph: dict) -> list:
    return [
        n for n in graph["nodes"]
        if n["in_degree"] == 0 and n["category"] != "test"
    ]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_category(path: str) -> str:
    if "/Tests/" in path or "Tests/" in path:
        return "test"
    if "/Helpers/" in path or "/Util/" in path:
        return "util"
    return "source"


# ─── Save ─────────────────────────────────────────────────────────────────────

def save_graph(graph: dict, path: str = "backend/cached/katana.graph.json") -> None:
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(graph, f, indent=2)
    print(f"Saved → {path} ({len(graph['nodes'])} nodes, {len(graph['edges'])} edges)")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os

    ir_path = os.path.join(os.path.dirname(__file__), "..", "tests", "parser_tests", "output.json")
    out_path = os.path.join(os.path.dirname(__file__), "..", "tests", "ir_compiler_tests", "normal_output.json")
    with open(ir_path) as f:
        ir = json.load(f)

    graph = build_call_graph(ir)
    save_graph(graph, out_path)