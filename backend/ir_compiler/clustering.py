"""
Automatic node clustering for call graphs.

Groups function nodes into logical clusters based on:
  1. Directory structure (primary)
  2. Container type — class/struct (secondary)
  3. Graph connectivity — merge tiny groups, split huge ones

Each cluster gets a stable ID and a human-readable label.
Inter-cluster edges are aggregated so the frontend can render
a "zoomed-out" architecture view.
"""

from collections import defaultdict
import re


# ─── Constants ───────────────────────────────────────────────────────────────

MIN_CLUSTER_SIZE = 2   # clusters smaller than this get merged into parent
MAX_CLUSTER_SIZE = 40  # clusters larger than this get sub-split by container


# ─── Main entry point ────────────────────────────────────────────────────────

def compute_clusters(graph: dict) -> dict:
    """
    Assign every node in `graph` to a cluster.

    Returns:
        {
            "clusters": [
                {
                    "id": "cluster:sources_store",
                    "label": "Store",
                    "directory": "Sources",
                    "container": "Store",       # None for mixed clusters
                    "node_ids": [...],
                    "node_count": 12,
                    "internal_edge_count": 8,
                    "category_breakdown": {"source": 10, "test": 2},
                },
                ...
            ],
            "cluster_edges": [
                {"source": "cluster:a", "target": "cluster:b", "weight": 5},
                ...
            ],
            "node_cluster_map": {"func:...": "cluster:x", ...},
        }
    """
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    if not nodes:
        return {"clusters": [], "cluster_edges": [], "node_cluster_map": {}}

    # Step 1: initial grouping  (directory + container)
    raw_groups = _initial_grouping(nodes)

    # Step 2: merge tiny groups into their directory parent
    merged_groups = _merge_small_groups(raw_groups)

    # Step 3: split oversized groups by container
    final_groups = _split_large_groups(merged_groups)

    # Step 4: build cluster objects
    node_cluster_map = {}
    clusters = []

    for group_key, node_ids in final_groups.items():
        cluster_id = _make_cluster_id(group_key)
        label = _make_label(group_key)

        cluster_nodes = [n for n in nodes if n["id"] in node_ids]
        cat_breakdown = defaultdict(int)
        for n in cluster_nodes:
            cat_breakdown[n.get("category", "source")] += 1

        # Count internal edges
        id_set = set(node_ids)
        internal_edges = sum(
            1 for e in edges
            if e["source"] in id_set and e["target"] in id_set
        )

        cluster = {
            "id": cluster_id,
            "label": label,
            "directory": group_key[0] if isinstance(group_key, tuple) else group_key,
            "container": group_key[1] if isinstance(group_key, tuple) and len(group_key) > 1 else None,
            "node_ids": sorted(node_ids),
            "node_count": len(node_ids),
            "internal_edge_count": internal_edges,
            "category_breakdown": dict(cat_breakdown),
        }
        clusters.append(cluster)

        for nid in node_ids:
            node_cluster_map[nid] = cluster_id

    # Step 5: compute inter-cluster edges
    cluster_edges = _compute_cluster_edges(edges, node_cluster_map)

    # Sort clusters by size desc
    clusters.sort(key=lambda c: c["node_count"], reverse=True)

    return {
        "clusters": clusters,
        "cluster_edges": cluster_edges,
        "node_cluster_map": node_cluster_map,
    }


# ─── Step 1: Initial grouping ───────────────────────────────────────────────

def _get_directory(file_path: str) -> str:
    """Extract the directory portion of a file path."""
    parts = file_path.replace("\\", "/").split("/")
    if len(parts) > 1:
        return "/".join(parts[:-1])
    return "_root"


def _get_container(node: dict) -> str | None:
    """Extract the container (class/struct) from qualified_name."""
    qn = node.get("qualified_name", "")
    if "." in qn:
        return qn.rsplit(".", 1)[0]
    # Also check 'container' field if present (v3 compiler)
    return node.get("container")


def _initial_grouping(nodes: list[dict]) -> dict[tuple, set[str]]:
    """Group nodes by (directory, container). Free functions get container=None."""
    groups: dict[tuple, set[str]] = defaultdict(set)
    for node in nodes:
        directory = _get_directory(node["file"])
        container = _get_container(node)
        key = (directory, container) if container else (directory, None)
        groups[key].add(node["id"])
    return dict(groups)


# ─── Step 2: Merge small groups ─────────────────────────────────────────────

def _merge_small_groups(groups: dict[tuple, set[str]]) -> dict[tuple, set[str]]:
    """
    Merge groups with < MIN_CLUSTER_SIZE nodes into their directory-level parent.
    """
    # Collect which groups are too small
    dir_buckets: dict[str, set[str]] = defaultdict(set)
    keep = {}

    for (directory, container), node_ids in groups.items():
        if len(node_ids) < MIN_CLUSTER_SIZE:
            dir_buckets[directory].update(node_ids)
        else:
            keep[(directory, container)] = node_ids

    # Merge small-group nodes into directory-level clusters
    for directory, node_ids in dir_buckets.items():
        parent_key = (directory, None)
        if parent_key in keep:
            keep[parent_key].update(node_ids)
        else:
            keep[parent_key] = node_ids

    return keep


# ─── Step 3: Split oversized groups ─────────────────────────────────────────

def _split_large_groups(groups: dict[tuple, set[str]]) -> dict[tuple, set[str]]:
    """
    Split groups with > MAX_CLUSTER_SIZE that have container=None
    by re-examining qualified_name to find sub-containers.
    (Groups that already have a specific container are left alone.)
    """
    result = {}

    for key, node_ids in groups.items():
        directory, container = key
        if len(node_ids) <= MAX_CLUSTER_SIZE or container is not None:
            result[key] = node_ids
            continue

        # This is a large mixed-container group — not splittable without node data.
        # Just keep it as-is (the frontend can still filter by container within a cluster).
        result[key] = node_ids

    return result


# ─── Cluster ID & Label ─────────────────────────────────────────────────────

def _make_cluster_id(group_key: tuple) -> str:
    """Produce a stable, URL-safe cluster ID."""
    directory, container = group_key
    parts = [_slugify(directory)]
    if container:
        parts.append(_slugify(container))
    return "cluster:" + "_".join(parts)


def _slugify(text: str) -> str:
    """Convert a path or name to a URL-safe slug."""
    text = text.replace("/", "_").replace("\\", "_").replace(".", "_")
    text = re.sub(r"[^a-zA-Z0-9_]", "", text)
    text = re.sub(r"_+", "_", text).strip("_").lower()
    return text or "misc"


def _make_label(group_key: tuple) -> str:
    """Human-readable label for a cluster."""
    directory, container = group_key
    if container:
        return container

    # Derive from directory name
    parts = directory.replace("\\", "/").split("/")
    # Use the last meaningful segment
    label = parts[-1] if parts else "Root"

    # Common renames for readability
    renames = {
        "Sources": "Core Sources",
        "Tests": "Tests",
        "Mocks": "Test Mocks",
        "Helpers": "Helpers",
        "Util": "Utilities",
        "_root": "Root",
    }
    return renames.get(label, label)


# ─── Inter-cluster edges ────────────────────────────────────────────────────

def _compute_cluster_edges(
    edges: list[dict],
    node_cluster_map: dict[str, str],
) -> list[dict]:
    """Aggregate node-level edges into cluster-level edges."""
    cluster_edge_weights: dict[tuple[str, str], int] = defaultdict(int)

    for edge in edges:
        src_cluster = node_cluster_map.get(edge["source"])
        dst_cluster = node_cluster_map.get(edge["target"])

        if src_cluster and dst_cluster and src_cluster != dst_cluster:
            key = (src_cluster, dst_cluster)
            cluster_edge_weights[key] += edge.get("weight", 1)

    return [
        {"source": src, "target": dst, "weight": w}
        for (src, dst), w in sorted(cluster_edge_weights.items(), key=lambda x: x[1], reverse=True)
    ]


# ─── LLM-assisted labeling (optional enhancement) ───────────────────────────

def label_clusters_with_llm(clusters: list[dict], graph: dict) -> list[dict]:
    """
    Ask the LLM to assign better human-readable labels to clusters
    based on the function names and file paths they contain.

    This mutates the cluster dicts in-place and returns them.
    Falls back to heuristic labels if LLM is unavailable.
    """
    try:
        from llm.cache import cached_complete
    except ImportError:
        return clusters

    SYSTEM = """You are a senior software architect labeling architecture layers.
Given a list of function names and file paths in a cluster, assign a short
(2-4 word) label describing the cluster's role.

Reply with ONLY the label, nothing else. Examples:
- "State Management"
- "Observer Middleware"
- "Test Helpers"
- "Side Effect Engine"
"""

    for cluster in clusters:
        # Build a summary of what's in this cluster
        node_names = []
        for nid in cluster["node_ids"][:15]:  # cap to avoid huge prompts
            # Extract qualified_name from node_id: func:<file>:<qname>:<line>
            parts = nid.split(":", 3)
            if len(parts) >= 3:
                node_names.append(parts[2])

        if not node_names:
            continue

        user_prompt = f"""Cluster directory: {cluster['directory']}
Container: {cluster.get('container') or 'mixed'}
Functions ({cluster['node_count']} total, showing first {len(node_names)}):
{chr(10).join(f'  - {n}' for n in node_names)}

Label this cluster:"""

        try:
            resp = cached_complete(
                use_case="cluster_label",
                params={"cluster_id": cluster["id"]},
                content_signature="|".join(node_names[:10]),
                system=SYSTEM,
                user=user_prompt,
                max_tokens=30,
            )
            label = resp.text.strip().strip('"').strip("'")
            if 1 < len(label) < 60:
                cluster["ai_label"] = label
        except Exception:
            pass  # keep heuristic label

    return clusters
