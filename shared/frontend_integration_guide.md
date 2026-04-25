# Frontend Integration Guide — New Backend Features

Three new backend capabilities are ready for frontend integration:
1. **Node Clustering** — architecture-level grouping of functions
2. **Enhanced Impact Analysis** — risk levels, colors, safe-to-refactor badges
3. **AI Chat with Graph Context** — free-form Q&A about the codebase

All endpoints are under the existing FastAPI server (`http://localhost:5000`).

---

## 1. Node Clustering

### Endpoint

```
GET /graph/{graph_id}/clusters?ai_labels=false
```

**Query params:**
- `ai_labels` (bool, default `false`) — if `true`, uses LLM to generate better cluster labels (slower, requires LLM API key)

### Response Shape

```json
{
  "clusters": [
    {
      "id": "cluster:sources_store",
      "label": "Store",
      "ai_label": "State Management Core",  // only present if ai_labels=true
      "directory": "Sources",
      "container": "Store",                  // null for mixed clusters
      "node_ids": ["func:Sources/Store.swift:Store.dispatch:42", ...],
      "node_count": 16,
      "internal_edge_count": 5,
      "category_breakdown": {"source": 14, "test": 2}
    }
  ],
  "cluster_edges": [
    {
      "source": "cluster:sources_store",
      "target": "cluster:sources_interceptor_observerlogic",
      "weight": 4
    }
  ],
  "node_cluster_map": {
    "func:Sources/Store.swift:Store.dispatch:42": "cluster:sources_store"
  }
}
```

### Frontend Integration Ideas

**Architecture overview (zoomed-out graph):**
- Render each cluster as a single large node (use `node_count` for size)
- Render `cluster_edges` as edges between cluster nodes (use `weight` for thickness)
- Use `label` (or `ai_label` if available) as the node text
- Color by `category_breakdown` — mostly source = blue, mostly test = green

**Grouped node view:**
- Use react-flow's [grouping/subflow](https://reactflow.dev/docs/guides/sub-flows/) feature
- Each cluster becomes a parent node, function nodes are children
- `internal_edge_count` helps decide initial collapsed/expanded state

**Key fields for the frontend:**
| Field | Use |
|---|---|
| `cluster.id` | Stable key for state management |
| `cluster.label` | Display name (fallback from `ai_label`) |
| `cluster.node_ids` | Which nodes belong to this cluster |
| `cluster.node_count` | Size the cluster node |
| `cluster.internal_edge_count` | Density indicator (collapse if high) |
| `cluster_edges[].weight` | Edge thickness between clusters |
| `node_cluster_map` | Quick lookup: given a node ID, get its cluster |

---

## 2. Enhanced Impact Analysis

### Endpoint (unchanged URL, enriched response)

```
POST /predict-impact
Body: { "node_id": "func:Sources/Store.swift:Store.dispatch:42" }
```

### Response Shape (new fields marked with ✦)

```json
{
  "node_id": "func:...",
  "affected": [
    {
      "id": "func:Sources/Store.swift:Store.middlewareDispatch:80",
      "distance": 1,
      "risk_score": 3.9957,
      "risk_level": "high",       // ✦ "low" | "medium" | "high"
      "color": "#ef4444",          // ✦ hex color: green→yellow→red
      "path": ["func:...", "func:..."]
    }
  ]
}
```

### Risk thresholds

| risk_level | risk_score range | color range |
|---|---|---|
| `high` | ≥ 0.7 | red (#ef4444) |
| `medium` | 0.3 – 0.7 | yellow (#eab308) |
| `low` | < 0.3 | green (#22c55e) |

### Frontend Integration Ideas

**Visual impact heatmap:**
- When user selects a node and clicks "What breaks?", highlight affected nodes
- Set each affected node's background/border to `color` from the response
- Show `risk_level` as a badge ("HIGH", "MEDIUM", "LOW")
- Animate ripple effect outward by `distance` (distance 1 first, then 2, etc.)

**Impact panel:**
- Sidebar list of affected functions sorted by `risk_score` desc
- Each entry shows: function name, risk badge, distance, file path
- Click an entry to navigate to that node in the graph

---

## 3. Safe to Refactor

### Endpoint

```
GET /query/safe-to-refactor
```

### Response Shape

```json
{
  "name": "safe_to_refactor",
  "count": 59,
  "results": [
    {
      "id": "func:Sources/SideEffect.swift:AnySideEffectContext.dispatch:69",
      "qualified_name": "AnySideEffectContext.dispatch",
      "name": "dispatch",
      "file": "Sources/SideEffect.swift",
      "line": 69,
      "in_degree": 0,
      "out_degree": 0,
      "category": "source",
      "safe_to_refactor": true,
      "reason": "No callers — isolated function, change freely"
    }
  ]
}
```

### Frontend Integration Ideas

**Badge on nodes:**
- Nodes that appear in safe-to-refactor results get a green shield/badge
- Tooltip shows `reason`

**Filter mode:**
- Toggle "Show safe to refactor" — dims all unsafe nodes, highlights safe ones
- Combine with cluster view to find safe clusters

---

## 4. AI Chat

### Endpoint

```
POST /llm/chat
Body: {
  "question": "Why does Store.dispatch call so many things?",
  "context_node_ids": ["func:Sources/Store.swift:Store.dispatch:42"]  // optional
}
```

If `context_node_ids` is empty, the backend auto-selects the top 5 hotspot nodes as context.

### Response Shape

```json
{
  "answer": "Store.dispatch is the central dispatch mechanism...",
  "tokens_used": 342,
  "cached": false,
  "context_node_count": 5
}
```

### Frontend Integration Ideas

**Chat panel:**
- Floating chat panel (bottom-right or sidebar)
- User types a question, response streams back (currently not streaming — consider polling or switch to SSE later)
- Show "Based on N nodes" indicator from `context_node_count`

**Context-aware chat:**
- When user right-clicks a node → "Ask about this function"
- Pre-fill `context_node_ids` with the selected node + its neighbors
- When user selects multiple nodes → "Ask about these functions"

**Suggested questions (based on current view):**
- If viewing a cluster: "What does this module do?"
- If viewing impact results: "Is this change safe?"
- If viewing dead code: "Should I delete these functions?"

---

## Data Flow Summary

```
User loads graph
  → GET /graph/{id}              → nodes, edges
  → GET /graph/{id}/clusters     → clusters, cluster_edges, node_cluster_map

User clicks a node
  → POST /predict-impact         → affected nodes with risk_level + color
  → GET /query/safe-to-refactor  → badge data (cache this on first load)

User asks a question
  → POST /llm/chat               → answer with graph context

User wants overview
  → POST /llm/overview           → codebase summary (existing)
```

## Zustand Store Suggestions

```javascript
// New slices to add to the existing store:

// Cluster state
clusters: [],
clusterEdges: [],
nodeClusterMap: {},
clusterViewActive: false,

// Impact state (enhance existing)
impactResults: [],        // now includes risk_level, color
safeToRefactor: [],       // cached list from /query/safe-to-refactor

// Chat state
chatMessages: [],         // { role: 'user'|'assistant', content: string }
chatLoading: false,
```

## TanStack Query Keys

```javascript
// Suggested query keys for caching:
['clusters', graphId]           // GET /graph/{id}/clusters
['safe-to-refactor']            // GET /query/safe-to-refactor (cache aggressively)
['impact', nodeId]              // POST /predict-impact
['chat', questionHash]          // POST /llm/chat (cache by question)
```
