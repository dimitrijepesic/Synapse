#!/usr/bin/env python3
"""
Integration tests for the three new backend features:
  1. Node clustering
  2. Enhanced predict_impact (risk levels, colors, safe_to_refactor)
  3. AI chat with graph context (structure only — LLM not called)
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ir_compiler.ir_compiler import (
    build_call_graph,
    predict_impact,
    hotspots,
    dead_code,
    get_node_with_neighbors,
    safe_to_refactor,
)
from ir_compiler.clustering import compute_clusters

TESTS_DIR = os.path.dirname(__file__)
CACHED_DIR = os.path.join(TESTS_DIR, "..", "cached")
IR_TESTS_DIR = os.path.join(TESTS_DIR, "ir_compiler_tests")


def load_json(path):
    with open(path) as f:
        return json.load(f)


# ═════════════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════════════

def _find_connected_node(graph):
    """Find a node with at least one edge for impact testing."""
    for n in graph["nodes"]:
        if n["in_degree"] > 0 or n["out_degree"] > 0:
            impact = predict_impact(graph, n["id"])
            if impact:
                return n
    return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. Clustering Tests
# ═════════════════════════════════════════════════════════════════════════════

def test_clustering_basic(graph):
    """Every node must be assigned to exactly one cluster."""
    diffs = []
    result = compute_clusters(graph)

    if not result["clusters"]:
        diffs.append("no clusters produced")
        return diffs

    # Check that every node is mapped
    all_node_ids = {n["id"] for n in graph["nodes"]}
    mapped_ids = set(result["node_cluster_map"].keys())

    missing = all_node_ids - mapped_ids
    if missing:
        diffs.append(f"{len(missing)} nodes not assigned to any cluster")

    extra = mapped_ids - all_node_ids
    if extra:
        diffs.append(f"{len(extra)} mapped IDs don't exist in graph")

    return diffs


def test_clustering_ids_unique(graph):
    """Cluster IDs must be unique."""
    diffs = []
    result = compute_clusters(graph)

    ids = [c["id"] for c in result["clusters"]]
    if len(ids) != len(set(ids)):
        dupes = [x for x in ids if ids.count(x) > 1]
        diffs.append(f"duplicate cluster IDs: {set(dupes)}")

    return diffs


def test_clustering_no_overlap(graph):
    """A node must appear in exactly one cluster."""
    diffs = []
    result = compute_clusters(graph)

    seen = {}
    for cluster in result["clusters"]:
        for nid in cluster["node_ids"]:
            if nid in seen:
                diffs.append(f"node {nid} in both {seen[nid]} and {cluster['id']}")
            seen[nid] = cluster["id"]

    return diffs


def test_clustering_fields(graph):
    """Each cluster dict must have the required fields."""
    diffs = []
    result = compute_clusters(graph)
    required = {"id", "label", "node_ids", "node_count", "internal_edge_count", "category_breakdown"}

    for cluster in result["clusters"]:
        missing = required - set(cluster.keys())
        if missing:
            diffs.append(f"cluster {cluster.get('id', '?')} missing fields: {missing}")
        if cluster["node_count"] != len(cluster["node_ids"]):
            diffs.append(
                f"cluster {cluster['id']}: node_count={cluster['node_count']} "
                f"but node_ids has {len(cluster['node_ids'])} entries"
            )

    return diffs


def test_cluster_edges_valid(graph):
    """Cluster edges must reference existing cluster IDs and not be self-loops."""
    diffs = []
    result = compute_clusters(graph)
    cluster_ids = {c["id"] for c in result["clusters"]}

    for ce in result["cluster_edges"]:
        if ce["source"] not in cluster_ids:
            diffs.append(f"cluster edge source {ce['source']} not a valid cluster")
        if ce["target"] not in cluster_ids:
            diffs.append(f"cluster edge target {ce['target']} not a valid cluster")
        if ce["source"] == ce["target"]:
            diffs.append(f"cluster self-loop: {ce['source']}")
        if ce["weight"] <= 0:
            diffs.append(f"cluster edge {ce['source']}->{ce['target']} has non-positive weight")

    return diffs


def test_cluster_edge_weights_consistent(graph):
    """Sum of cluster-edge weights must equal the number of cross-cluster node edges."""
    diffs = []
    result = compute_clusters(graph)
    ncm = result["node_cluster_map"]

    # Count cross-cluster edges at node level
    cross_count = 0
    for e in graph["edges"]:
        src_c = ncm.get(e["source"])
        dst_c = ncm.get(e["target"])
        if src_c and dst_c and src_c != dst_c:
            cross_count += e.get("weight", 1)

    cluster_weight_sum = sum(ce["weight"] for ce in result["cluster_edges"])

    if cross_count != cluster_weight_sum:
        diffs.append(
            f"cross-cluster node edge weight sum={cross_count} "
            f"but cluster_edges weight sum={cluster_weight_sum}"
        )

    return diffs


def test_clustering_empty_graph():
    """Clustering an empty graph should return empty results."""
    diffs = []
    empty = {"nodes": [], "edges": []}
    result = compute_clusters(empty)

    if result["clusters"]:
        diffs.append(f"expected 0 clusters for empty graph, got {len(result['clusters'])}")
    if result["cluster_edges"]:
        diffs.append(f"expected 0 cluster edges, got {len(result['cluster_edges'])}")
    if result["node_cluster_map"]:
        diffs.append(f"expected empty node_cluster_map, got {len(result['node_cluster_map'])} entries")

    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# 2. Enhanced Predict Impact Tests
# ═════════════════════════════════════════════════════════════════════════════

def test_impact_has_risk_fields(graph):
    """predict_impact results must include risk_level and color."""
    diffs = []
    node = _find_connected_node(graph)
    if not node:
        diffs.append("could not find a connected node for testing")
        return diffs

    impact = predict_impact(graph, node["id"])
    if not impact:
        diffs.append("predict_impact returned empty for connected node")
        return diffs

    for r in impact:
        if "risk_level" not in r:
            diffs.append(f"missing risk_level for {r['id']}")
            break
        if "color" not in r:
            diffs.append(f"missing color for {r['id']}")
            break
        if r["risk_level"] not in ("low", "medium", "high"):
            diffs.append(f"invalid risk_level '{r['risk_level']}' for {r['id']}")
            break

    return diffs


def test_impact_color_format(graph):
    """Colors must be valid hex strings."""
    diffs = []
    node = _find_connected_node(graph)
    if not node:
        return ["no connected node"]

    impact = predict_impact(graph, node["id"])
    import re
    hex_re = re.compile(r"^#[0-9a-f]{6}$")

    for r in impact:
        if not hex_re.match(r["color"]):
            diffs.append(f"invalid hex color '{r['color']}' for {r['id']}")
            break

    return diffs


def test_impact_risk_level_monotonic(graph):
    """Higher risk_score should produce equal or higher risk_level."""
    diffs = []
    node = _find_connected_node(graph)
    if not node:
        return ["no connected node"]

    impact = predict_impact(graph, node["id"])
    level_order = {"low": 0, "medium": 1, "high": 2}

    for i in range(len(impact) - 1):
        curr = impact[i]
        nxt = impact[i + 1]
        # results are sorted by risk_score desc
        if curr["risk_score"] < nxt["risk_score"]:
            diffs.append("results not sorted by risk_score desc")
            break
        curr_lvl = level_order[curr["risk_level"]]
        nxt_lvl = level_order[nxt["risk_level"]]
        if curr_lvl < nxt_lvl:
            diffs.append(
                f"risk_level not monotonic: score {curr['risk_score']}={curr['risk_level']} "
                f"then {nxt['risk_score']}={nxt['risk_level']}"
            )
            break

    return diffs


def test_impact_nonexistent_node(graph):
    """predict_impact on a non-existent node should return empty list."""
    diffs = []
    result = predict_impact(graph, "func:fake:file:0")
    if result:
        diffs.append(f"expected empty, got {len(result)} results")
    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# 3. Safe to Refactor Tests
# ═════════════════════════════════════════════════════════════════════════════

def test_safe_to_refactor_basic(graph):
    """All safe-to-refactor nodes must have in_degree <= 1 and not be tests."""
    diffs = []
    results = safe_to_refactor(graph)

    if not results:
        diffs.append("no safe_to_refactor results (unexpected for katana)")
        return diffs

    for r in results:
        if r["in_degree"] > 1:
            diffs.append(f"node {r['id']} has in_degree={r['in_degree']} > 1")
        if r["category"] == "test":
            diffs.append(f"node {r['id']} is a test, should be excluded")
        if not r.get("safe_to_refactor"):
            diffs.append(f"node {r['id']} missing safe_to_refactor=True")
        if not r.get("reason"):
            diffs.append(f"node {r['id']} missing reason string")

    return diffs


def test_safe_to_refactor_has_reason(graph):
    """Every safe node must have a non-empty reason."""
    diffs = []
    for r in safe_to_refactor(graph):
        if not isinstance(r.get("reason"), str) or len(r["reason"]) < 5:
            diffs.append(f"node {r['id']} has invalid reason: {r.get('reason')!r}")
            break
    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# 4. AI Chat Structure Tests (no LLM call)
# ═════════════════════════════════════════════════════════════════════════════

def test_chat_context_building(graph):
    """
    Verify chat_with_graph constructs proper args without calling LLM.
    We test the input assembly, not the LLM response.
    """
    diffs = []

    # Build the same context the endpoint would build
    hot = hotspots(graph, top_n=5)
    context_nodes = []
    for h in hot:
        result = get_node_with_neighbors(graph, h["id"])
        if result:
            context_nodes.append(result)

    if not context_nodes:
        diffs.append("could not build any context nodes from hotspots")
        return diffs

    graph_metadata = {
        "node_count": len(graph["nodes"]),
        "edge_count": len(graph["edges"]),
        "hotspots": hot,
    }

    # Verify the metadata structure is what chat_with_graph expects
    if graph_metadata["node_count"] <= 0:
        diffs.append("node_count should be positive")
    if graph_metadata["edge_count"] <= 0:
        diffs.append("edge_count should be positive")

    # Verify context nodes have the expected structure
    for cn in context_nodes:
        if "node" not in cn:
            diffs.append(f"context node missing 'node' key")
        if "callers" not in cn:
            diffs.append(f"context node missing 'callers' key")
        if "callees" not in cn:
            diffs.append(f"context node missing 'callees' key")

    return diffs


def test_chat_with_clusters(graph):
    """Verify chat can receive cluster data alongside graph metadata."""
    diffs = []

    clusters_result = compute_clusters(graph)
    clusters = clusters_result["clusters"]

    if not clusters:
        diffs.append("no clusters to test chat integration with")
        return diffs

    # Verify cluster format is compatible with chat_with_graph expectations
    for c in clusters[:3]:
        if "label" not in c:
            diffs.append(f"cluster {c.get('id')} missing label")
        if "node_count" not in c:
            diffs.append(f"cluster {c.get('id')} missing node_count")
        if "internal_edge_count" not in c:
            diffs.append(f"cluster {c.get('id')} missing internal_edge_count")

    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# 5. Cross-feature: Clustering + Impact integration
# ═════════════════════════════════════════════════════════════════════════════

def test_impact_nodes_have_clusters(graph):
    """Every node in predict_impact results should be mapped to a cluster."""
    diffs = []
    clusters = compute_clusters(graph)
    ncm = clusters["node_cluster_map"]

    node = _find_connected_node(graph)
    if not node:
        return ["no connected node"]

    impact = predict_impact(graph, node["id"])
    for r in impact:
        if r["id"] not in ncm:
            diffs.append(f"impacted node {r['id']} not in any cluster")

    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# 6. Testcase6 (animals) — small graph validation
# ═════════════════════════════════════════════════════════════════════════════

def test_clustering_small_graph():
    """Clustering should work on a small hand-crafted graph."""
    diffs = []
    ir_path = os.path.join(IR_TESTS_DIR, "testcase6_animals.json")
    if not os.path.exists(ir_path):
        return ["testcase6_animals.json not found"]

    ir = load_json(ir_path)
    graph = build_call_graph(ir)
    result = compute_clusters(graph)

    all_node_ids = {n["id"] for n in graph["nodes"]}
    mapped = set(result["node_cluster_map"].keys())

    if all_node_ids != mapped:
        diffs.append(f"mapping mismatch: {len(all_node_ids)} nodes vs {len(mapped)} mapped")

    # Small graph should have a reasonable number of clusters
    if len(result["clusters"]) == 0:
        diffs.append("0 clusters for non-empty graph")
    if len(result["clusters"]) > len(graph["nodes"]):
        diffs.append(f"more clusters ({len(result['clusters'])}) than nodes ({len(graph['nodes'])})")

    return diffs


def test_safe_to_refactor_small_graph():
    """safe_to_refactor on the animals graph."""
    diffs = []
    ir_path = os.path.join(IR_TESTS_DIR, "testcase6_animals.json")
    if not os.path.exists(ir_path):
        return ["testcase6_animals.json not found"]

    ir = load_json(ir_path)
    graph = build_call_graph(ir)
    safe = safe_to_refactor(graph)

    for r in safe:
        if r["in_degree"] > 1:
            diffs.append(f"node {r['qualified_name']} in_degree={r['in_degree']} > 1")
        if r["category"] == "test":
            diffs.append(f"test node {r['qualified_name']} should be excluded")

    return diffs


# ═════════════════════════════════════════════════════════════════════════════
# Runner
# ═════════════════════════════════════════════════════════════════════════════

ALL_TESTS = [
    # Clustering
    ("clustering_basic", test_clustering_basic, True),
    ("clustering_ids_unique", test_clustering_ids_unique, True),
    ("clustering_no_overlap", test_clustering_no_overlap, True),
    ("clustering_fields", test_clustering_fields, True),
    ("cluster_edges_valid", test_cluster_edges_valid, True),
    ("cluster_edge_weights_consistent", test_cluster_edge_weights_consistent, True),
    ("clustering_empty_graph", test_clustering_empty_graph, False),
    ("clustering_small_graph", test_clustering_small_graph, False),
    # Enhanced impact
    ("impact_has_risk_fields", test_impact_has_risk_fields, True),
    ("impact_color_format", test_impact_color_format, True),
    ("impact_risk_level_monotonic", test_impact_risk_level_monotonic, True),
    ("impact_nonexistent_node", test_impact_nonexistent_node, True),
    # Safe to refactor
    ("safe_to_refactor_basic", test_safe_to_refactor_basic, True),
    ("safe_to_refactor_has_reason", test_safe_to_refactor_has_reason, True),
    ("safe_to_refactor_small_graph", test_safe_to_refactor_small_graph, False),
    # Chat structure
    ("chat_context_building", test_chat_context_building, True),
    ("chat_with_clusters", test_chat_with_clusters, True),
    # Cross-feature
    ("impact_nodes_have_clusters", test_impact_nodes_have_clusters, True),
]


if __name__ == "__main__":
    print("=" * 60)
    print("NEW FEATURES — INTEGRATION TEST SUITE")
    print("=" * 60)

    # Load katana graph for tests that need it
    katana_path = os.path.join(CACHED_DIR, "katana.graph.json")
    if not os.path.exists(katana_path):
        print(f"ERROR: {katana_path} not found. Run build_katana_graph.py first.")
        sys.exit(1)
    katana = load_json(katana_path)

    results = []
    for name, test_fn, needs_graph in ALL_TESTS:
        print(f"\n{'='*60}")
        print(f"TEST: {name}")
        print(f"{'='*60}")

        try:
            if needs_graph:
                diffs = test_fn(katana)
            else:
                diffs = test_fn()
        except Exception as e:
            diffs = [f"EXCEPTION: {e}"]

        passed = len(diffs) == 0
        results.append((name, passed, diffs))

        if passed:
            print(f"  PASSED")
        else:
            print(f"  FAILED — {len(diffs)} issue(s):")
            for d in diffs[:10]:
                print(f"    - {d}")

    # Summary
    total = len(results)
    passed = sum(1 for _, p, _ in results if p)
    failed = total - passed

    print(f"\n{'='*60}")
    print(f"SUMMARY: {passed}/{total} passed, {failed} failed")
    print(f"{'='*60}")

    if failed > 0:
        print("\nFailed tests:")
        for name, p, diffs in results:
            if not p:
                print(f"\n  {name}:")
                for d in diffs[:10]:
                    print(f"    - {d}")

    sys.exit(1 if failed > 0 else 0)
