# Synapsis — Technical Build Spec

**Target:** Swift call graph for `github.com/BendingSpoons/katana-swift`. End-to-end web app. 18h, 4 people in parallel.

**Pipeline:**

```
Swift source → IR JSON → Graph JSON → HTTP API (+ LLM, + cache) → React UI
   (P1)          (P2)              (P3)                            (P4)
```

**Stack:**

- Python 3.12, `tree-sitter` + `tree-sitter-swift`, FastAPI, SQLite, `openai` SDK (Groq-compatible)
- React 19 + Vite 8 + JavaScript, custom SVG canvas (dagre layout), Tailwind 4, Zustand
- LLM: Groq (`llama-3.3-70b-versatile`) via OpenAI-compatible SDK
- Deploy: Render (Python buildpack, persistent disk), frontend built with Vite

**Repo layout:**

```
hackupc/
├── backend/
│   ├── parser/               # P1 — tree-sitter Swift parser
│   │   ├── base.py           #   dataclasses: FunctionInfo, FunctionCall, TypeInfo, FileResult, ParseResult
│   │   ├── langs/
│   │   │   └── swift.py      #   SwiftParser — walks tree-sitter AST
│   │   ├── merger.py         #   merges per-file ParseResults into single IR
│   │   ├── registry.py       #   extension-based parser registry
│   │   └── runner.py         #   parse_repo() entry point
│   ├── ir_compiler/          # P2 — graph builder + algorithms
│   │   ├── ir_compiler.py    #   build_call_graph, predict_impact, hotspots, dead_code, safe_to_refactor
│   │   └── clustering.py     #   compute_clusters, label_clusters_with_llm
│   ├── api/                  # P3 — FastAPI server
│   │   └── main.py           #   all endpoints, CORS, lifespan graph loading
│   ├── llm/                  # P3 — LLM integration
│   │   ├── providers.py      #   GroqProvider (OpenAI-compatible)
│   │   ├── cache.py          #   SQLite LLM response cache
│   │   └── use_cases.py      #   explain_node, codebase_overview, impact_narrative, chat_with_graph
│   ├── scripts/
│   │   ├── build_katana_graph.py
│   │   └── prefill_cache.py
│   ├── cached/               #   pre-built katana.ir.json + katana.graph.json
│   ├── data/katana/          #   cloned katana-swift repo (for code snippets)
│   └── tests/                #   parser + ir_compiler test suites
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── pages/
│       │   ├── Landing.jsx       # repo URL input, analyze button
│       │   ├── Home.jsx
│       │   ├── Login.jsx
│       │   └── Workspace.jsx     # main canvas: SVG graph + side panels
│       ├── components/Layout/
│       │   ├── Header.jsx
│       │   ├── Footer.jsx
│       │   └── index.js
│       ├── store/
│       │   ├── graphStore.js     # Zustand — nodes, edges, selection, graph loading
│       │   └── projectStore.js   # Zustand — UI state, project metadata
│       ├── data/mockData.js
│       └── types/api.js          # JSDoc types + API_BASE + ENDPOINTS
├── shared/
│   └── frontend_integration_guide.md
├── render.yaml               # Render deploy config
├── requirements.txt
├── CLAUDE.md
└── .env.example
```

---

## Shared Contracts

### 1. IR JSON (P1 → P2)

SOURCE CODE:

```swift
import Foundation
import Hydra

class Store {
    func dispatch() {
        runReducer()
        Logger.log()
    }
    
    func runReducer() {
        let x = 1
    }
}
```

```json
{
  "version": "1.0",
  "language": "swift",
  "repo": "BendingSpoons/katana-swift",
  "files": [
    {
      "path": "Sources/Katana/Store.swift",
      "imports": ["Foundation", "Hydra"],
      "types": [
        {
          "name": "Store",
          "kind": "class",
          "line_start": 3,
          "line_end": 13,
          "inherits": []
        }
      ],
      "functions": [
        {
          "qualified_name": "Store.dispatch",
          "name": "dispatch",
          "line_start": 4,
          "line_end": 7,
          "signature": "func dispatch()",
          "container": "Store",
          "params": [],
          "return_type": null,
          "calls": [
            {"target": "runReducer", "line": 5, "receiver": null, "method": "runReducer", "kind": "call"},
            {"target": "Logger.log", "line": 6, "receiver": "Logger", "method": "log", "kind": "method"}
          ]
        },
        {
          "qualified_name": "Store.runReducer",
          "name": "runReducer",
          "line_start": 9,
          "line_end": 11,
          "signature": "func runReducer()",
          "container": "Store",
          "params": [],
          "return_type": null,
          "calls": []
        }
      ]
    }
  ]
}
```

Rules:

- `qualified_name`: `Type.method` for methods, `name` alone for free functions, `Type.init` for initializers.
- `calls[].kind`: `"call"` (free function), `"method"` (dot-call), `"initializer"` (constructor).
- `calls[].receiver`: the object/type before the dot, or `null` for unqualified calls.
- `types[]`: every class/struct/enum/protocol/extension with `name`, `kind`, `inherits`, line range.
- `imports` field is reserved for future module-dep graph; P1 fills it, P2 ignores it for call graph.

### 2. Graph JSON (P2 → P3)

```json
{
  "graph_id": "katana",
  "nodes": [
    {
      "id": "func:Sources/Katana/Store.swift:Store.dispatch:42",
      "type": "function",
      "qualified_name": "Store.dispatch",
      "name": "dispatch",
      "file": "Sources/Katana/Store.swift",
      "line": 42,
      "line_end": 55,
      "signature": "func dispatch(_ action: Action) -> Promise<Void>",
      "params": [{"label": "_", "name": "action", "type": "Action"}],
      "return_type": "Promise<Void>",
      "container": "Store",
      "in_degree": 7,
      "out_degree": 4,
      "category": "source",
      "code_snippet": "..."
    }
  ],
  "edges": [
    {
      "source": "func:Sources/Katana/Store.swift:Store.dispatch:42",
      "target": "func:Sources/Katana/Store.swift:Store.runReducer:120",
      "type": "calls",
      "weight": 1
    }
  ],
  "source_files": {
    "Sources/Katana/Store.swift": "import Foundation\n..."
  }
}
```

Rules:

- Node ID format: `func:<file_path>:<qualified_name>:<line>`. Stable, used in URLs.
- `category`: `source` | `test` | `util`, derived from path heuristic.
- Multi-edges between same source/target collapse to single edge with `weight = count`.
- `code_snippet`: inlined at analyze-time from cloned repo source.
- `source_files`: full file contents keyed by relative path, for frontend code panel.

### 3. HTTP API (P3 → P4)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/health` | — | `{ok, node_count, edge_count, cache_entries}` |
| `POST` | `/analyze` | `{repo_url}` | `{graph_id, status: "ready", node_count, edge_count}` — clones repo, parses, builds graph live |
| `POST` | `/upload` | multipart file (.zip/.tar/.swift) | `{graph_id, status: "ready", node_count, edge_count}` |
| `GET` | `/graph/{graph_id}` | — | full Graph JSON |
| `GET` | `/node/{node_id}` | — | `{node, callers, callees, code_snippet}` |
| `POST` | `/predict-impact` | `{node_id}` | `{node_id, affected: [{id, distance, risk_score, path}]}` |
| `GET` | `/query/hotspots` | — | `{name, results: [...]}` |
| `GET` | `/query/dead_code` | — | `{name, results: [...]}` |
| `GET` | `/query/safe-to-refactor` | — | `{name, count, results: [...]}` |
| `POST` | `/llm/explain-node` | `{node_id}` | `{node, callers, callees, code_snippet, explanation, tokens_used, cached}` |
| `POST` | `/llm/overview` | `{}` | `{summary, tokens_used, cached}` |
| `POST` | `/llm/impact-narrative` | `{node_id}` | `{narrative, tokens_used, cached}` |
| `POST` | `/llm/chat` | `{question, context_node_ids: []}` | `{answer, tokens_used, cached}` |
| `GET` | `/graph/{graph_id}/clusters` | `?ai_labels=false` | `{clusters: [...], inter_cluster_edges: [...]}` |

CORS open to all origins. No auth.

---

## P1 — Swift Parser

**Output:** IR JSON matching schema above. Multi-language registry (currently Swift only).

**Architecture:**

- `base.py` — dataclasses: `Param`, `FunctionCall`, `FunctionInfo`, `TypeInfo`, `FileResult`, `ParseResult`
- `registry.py` — decorator-based parser registration by file extension
- `langs/swift.py` — `SwiftParser`: walks tree-sitter AST, extracts functions, calls, types
- `merger.py` — merges per-file results into single IR dict
- `runner.py` — `parse_repo()`: walks directory, delegates to registered parser per extension

**Key behaviors:**

- Qualified names: walks up AST parents for `class_declaration`, `protocol_declaration`, `extension_declaration`
- Call extraction: `call_expression` nodes, classifies as `call`/`method`/`initializer`
- Type extraction: class, struct, enum, protocol, extension — with inheritance info
- Implicit self resolution and call kind refinement in post-processing (`runner.py`)

---

## P2 — Graph Builder + Algorithms

**Output:** `backend/cached/katana.graph.json` + Python module `ir_compiler` with exports:

```python
from ir_compiler.ir_compiler import (
    build_call_graph,         # ir_dict -> graph_dict
    predict_impact,           # (graph, node_id) -> ranked list
    get_node_with_neighbors,  # (graph, node_id) -> {node, callers, callees}
    hotspots,                 # (graph, top_n=10) -> list
    dead_code,                # (graph) -> list
    safe_to_refactor,         # (graph) -> list
)
from ir_compiler.clustering import (
    compute_clusters,         # graph -> {clusters, inter_cluster_edges}
    label_clusters_with_llm,  # (clusters, graph) -> mutates cluster labels
)
```

**Key behaviors:**

- Call resolution: exact qualified_name match → unqualified name match (if unique) → type-aware lookup via `known_types` and `inherits_map`
- `predict_impact`: bidirectional BFS (distance cap 4), `risk_score = (1/(1+d)) * weight * (1 + log(in_degree))`
- `compute_clusters`: groups by directory → container type → merges tiny clusters, splits large ones
- `safe_to_refactor`: nodes with low in_degree, non-test, non-constructor

---

## P3 — Backend (FastAPI + LLM + Cache)

**Output:** Running FastAPI server on Render.

**Key behaviors:**

- On startup: loads `backend/cached/katana.graph.json` into memory
- `POST /analyze`: clones repo via `git clone --depth 1`, runs parser + graph builder, inlines code snippets and source files, stores in-memory
- `POST /upload`: accepts archives or single source files, same pipeline
- LLM: Groq provider via OpenAI-compatible SDK (`llama-3.3-70b-versatile`)
- SQLite cache: keyed by `sha256(use_case + params + content_signature + model)`, stores responses with token counts
- LLM use cases: explain node, codebase overview, impact narrative, chat with graph context

**Deploy:**

- `render.yaml`: Python service, persistent disk at `/var/data` for `cache.sqlite` and graph files
- Env vars: `LLM_API_KEY`, `LLM_PROVIDER=groq`, `LLM_MODEL`, `LLM_BASE_URL`, `CACHE_PATH`, `FRONTEND_ORIGIN`

---

## P4 — Frontend

**Output:** React app, Vite-built, dark mode.

**Layout:**

```
┌─────────────────────────────────────────────────┐
│ Header: repo URL input | Analyze | Upload        │
├──────────────────────────────────────────────────┤
│                                  │ Side panel    │
│   Custom SVG canvas              │ - Code panel  │
│   (dagre-layouted graph)         │ - Callers     │
│                                  │ - Callees     │
│                                  │ - Impact list │
│                                  │ - LLM explain │
│                                  │ - AI Chat     │
└──────────────────────────────────┴──────────────┘
```

**Key behaviors:**

- Graph rendering: custom SVG with dagre auto-layout, orthogonal edges with rounded corners
- Node styling: color by category (source/test/util), badges for dead code/entry/leaf
- Canvas filters: Dead (in_degree=0), Entry (in_degree=0), Leaf (out_degree=0)
- Node click → fetches `/node/{id}`, populates side panel with code + callers/callees
- Predict Impact → ripple animation, colors nodes by risk score
- Explain with AI → LLM response with cached/live indicator + token count
- AI Chat → free-form Q&A about the loaded codebase
- Cluster view → architecture-level grouping with inter-cluster edges
- State: Zustand (`graphStore.js` for graph data, `projectStore.js` for UI state)

---

## Integration & Artifacts

**Three artifacts on disk for demo:**

| File | Owner | Consumed by |
| --- | --- | --- |
| `backend/cached/katana.ir.json` | P1 | P2 |
| `backend/cached/katana.graph.json` | P2 | P3 (loaded on server start) |
| `backend/cache.sqlite` | P3 | runtime (LLM response cache) |

**Live analysis also works:** paste any GitHub URL → backend clones, parses, builds graph on the fly. Also supports file upload (.zip, .tar.gz, or single source files).

---

## Pitch

### Demo Flow

**Part 1 — Katana Swift (30s)**
Short pre-recorded video. Open Synapsis, Katana is pre-loaded. Click through `Store.dispatch` → see callers/callees → predict impact → ripple animation → explain with AI. Shows the product working on a real-world open-source Swift codebase.

**Part 2 — Eating our own dog food (90s)**
Live or pre-recorded. Point Synapsis at `github.com/dimitrijepesic/hackupc` — our own repo. Analyze it. Walk through our own architecture as rendered by Synapsis:
- Show the parser → ir_compiler → api pipeline as actual nodes in the graph
- Click on `build_call_graph` — see it calls `predict_impact`, `hotspots`, `dead_code`
- Hit "Explain with AI" on our own `parse_repo` function
- Show clusters: parser cluster, ir_compiler cluster, api cluster, llm cluster
- Predict impact on `build_call_graph` — see how a change ripples through the backend

**Key message:** "We built a tool to understand codebases. The best proof it works? We used it to understand itself."

### Talking Points

- **Problem:** Large codebases are hard to navigate. "What calls this function? What breaks if I change it?" are questions every developer asks daily.
- **Solution:** Synapsis parses source code with tree-sitter, builds a call graph, and layers AI on top for natural-language explanations and impact prediction.
- **Tech:** tree-sitter for multi-language AST parsing, custom graph algorithms for impact analysis, Groq LLM for instant AI explanations with SQLite caching.
- **Live analysis:** Not just a static demo — paste any GitHub URL and get a call graph in seconds.
- **Self-referential demo:** We analyze our own codebase to prove the tool works.
