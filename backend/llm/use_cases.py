"""LLM use cases: explain node, codebase overview, impact narrative, graph chat."""
from .cache import cached_complete


# --- explain_node ---

EXPLAIN_NODE_SYSTEM = """You are a senior Swift engineer explaining a function to a developer.
Be concise (3-5 sentences). Focus on:
- What the function does
- How it fits in the call graph (mention notable callers/callees)
- Any non-obvious behavior

Plain prose, no markdown headers, no bullets."""


def explain_node(node: dict, callers: list, callees: list, code_snippet: str) -> dict:
    caller_names = ", ".join(c["qualified_name"] for c in callers[:5]) or "none"
    callee_names = ", ".join(c["qualified_name"] for c in callees[:5]) or "none"

    user = f"""Function: {node['qualified_name']}
File: {node['file']}:{node['line']}
Signature: {node['signature']}
Called by: {caller_names}
Calls: {callee_names}

Source:
```swift
{code_snippet}
```

Explain this function."""

    resp = cached_complete(
        use_case="explain_node",
        params={"node_id": node["id"]},
        content_signature=f"{node['signature']}|{code_snippet[:500]}",
        system=EXPLAIN_NODE_SYSTEM,
        user=user,
        max_tokens=400,
    )
    return {
        "explanation": resp.text,
        "tokens_used": resp.input_tokens + resp.output_tokens,
        "cached": resp.cached,
    }


# --- codebase_overview ---

OVERVIEW_SYSTEM = """You are a senior Swift engineer summarizing a codebase for a new contributor.
4-6 sentences total. Cover:
- What the library does
- Core architectural pattern (e.g. Redux-like, MVC, etc.)
- The most important entry points

Plain prose."""


def codebase_overview(top_hotspots: list, total_nodes: int, total_edges: int) -> dict:
    hotspot_lines = "\n".join(
        f"- {h['qualified_name']} ({h['file']}, in_degree={h['in_degree']})"
        for h in top_hotspots[:10]
    )

    user = f"""Codebase: BendingSpoons/katana-swift
Total functions: {total_nodes}
Total call edges: {total_edges}

Top called functions (hotspots):
{hotspot_lines}

Summarize this codebase."""

    resp = cached_complete(
        use_case="codebase_overview",
        params={"node_count": total_nodes},
        content_signature=hotspot_lines,
        system=OVERVIEW_SYSTEM,
        user=user,
        max_tokens=400,
    )
    return {
        "overview": resp.text,
        "tokens_used": resp.input_tokens + resp.output_tokens,
        "cached": resp.cached,
    }


# --- impact_narrative ---

IMPACT_SYSTEM = """You are a senior Swift engineer assessing change risk.
Given a target function and the functions a change to it would affect, write a 3-4 sentence narrative.
Cover:
- The blast radius (how much breaks)
- Most critical affected paths
- Risk level (low/medium/high) with one-line justification

Plain prose."""


def impact_narrative(node: dict, affected: list) -> dict:
    affected_lines = "\n".join(
        f"- {a['id'].split(':')[2]} (distance={a['distance']}, risk={a['risk_score']})"
        for a in affected[:10]
    )

    user = f"""Target function: {node['qualified_name']} ({node['file']}:{node['line']})

If this function changes, these are the {len(affected)} most affected functions:
{affected_lines}

Write the impact narrative."""

    resp = cached_complete(
        use_case="impact_narrative",
        params={"node_id": node["id"], "affected_count": len(affected)},
        content_signature=affected_lines,
        system=IMPACT_SYSTEM,
        user=user,
        max_tokens=400,
    )
    return {
        "narrative": resp.text,
        "tokens_used": resp.input_tokens + resp.output_tokens,
        "cached": resp.cached,
    }


# --- chat_with_graph ---

CHAT_SYSTEM = """You are a senior software architect answering questions about a codebase.
You have access to the call graph structure — you know which functions call which,
their relationships, and overall architecture.

Unlike a generic code assistant, you use STRUCTURAL context (call graph, clusters,
dependencies) to give precise answers about how code flows, what depends on what,
and why things are organized the way they are.

Be concise but thorough. Use function names and file paths when relevant.
If the graph context doesn't contain enough information to answer fully, say so."""


def chat_with_graph(
    question: str,
    graph_metadata: dict,
    context_nodes: list[dict],
    clusters: list[dict] | None = None,
) -> dict:
    """
    Answer a free-form question using the call graph as context.

    Args:
        question: User's question in natural language
        graph_metadata: Summary stats (node_count, edge_count, hotspots, etc.)
        context_nodes: Relevant nodes with their callers/callees
        clusters: Optional cluster summary for architecture questions
    """
    # Build the context block
    sections = []

    # Graph overview
    sections.append(f"CODEBASE OVERVIEW:")
    sections.append(f"  Total functions: {graph_metadata.get('node_count', '?')}")
    sections.append(f"  Total call edges: {graph_metadata.get('edge_count', '?')}")

    # Top hotspots
    hotspot_list = graph_metadata.get("hotspots", [])
    if hotspot_list:
        sections.append(f"\nTOP HOTSPOTS (most-called functions):")
        for h in hotspot_list[:8]:
            name = h.get("qualified_name", h.get("name", "?"))
            sections.append(f"  - {name} (in_degree={h.get('in_degree', '?')})")

    # Cluster summary
    if clusters:
        sections.append(f"\nARCHITECTURE CLUSTERS ({len(clusters)} groups):")
        for c in clusters[:10]:
            label = c.get("ai_label", c.get("label", c["id"]))
            sections.append(
                f"  - {label}: {c['node_count']} functions, "
                f"{c['internal_edge_count']} internal calls"
            )

    # Context nodes (the ones most relevant to the question)
    if context_nodes:
        sections.append(f"\nRELEVANT FUNCTIONS ({len(context_nodes)} shown):")
        for cn in context_nodes[:10]:
            node = cn.get("node", cn)
            callers = cn.get("callers", [])
            callees = cn.get("callees", [])
            sections.append(
                f"\n  [{node.get('qualified_name', node.get('name', '?'))}]"
                f"  file: {node.get('file', '?')}:{node.get('line', '?')}"
            )
            if node.get("signature"):
                sig = node["signature"].replace("\r\n", " ").replace("\n", " ")[:120]
                sections.append(f"  signature: {sig}")
            if callers:
                caller_names = ", ".join(
                    c.get("qualified_name", c.get("name", "?")) for c in callers[:5]
                )
                sections.append(f"  called by: {caller_names}")
            if callees:
                callee_names = ", ".join(
                    c.get("qualified_name", c.get("name", "?")) for c in callees[:5]
                )
                sections.append(f"  calls: {callee_names}")
            snippet = node.get("code_snippet", "")
            if snippet and not snippet.startswith("//"):
                # Truncate long snippets
                lines = snippet.split("\n")[:15]
                sections.append(f"  code:\n" + "\n".join(f"    {l}" for l in lines))

    context_block = "\n".join(sections)

    user = f"""CALL GRAPH CONTEXT:
{context_block}

QUESTION: {question}"""

    # Use a content signature that captures the question + key context
    sig_parts = [question[:200]]
    for cn in context_nodes[:3]:
        node = cn.get("node", cn)
        sig_parts.append(node.get("id", ""))

    resp = cached_complete(
        use_case="chat_with_graph",
        params={"question_hash": hash(question) % (10**8)},
        content_signature="|".join(sig_parts),
        system=CHAT_SYSTEM,
        user=user,
        max_tokens=800,
    )
    return {
        "answer": resp.text,
        "tokens_used": resp.input_tokens + resp.output_tokens,
        "cached": resp.cached,
        "context_node_count": len(context_nodes),
    }