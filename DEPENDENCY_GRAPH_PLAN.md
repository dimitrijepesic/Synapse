# Dependency Graph Feature — Implementation Plan

**Goal:** add a module/import dependency graph view alongside the existing call graph and control flow views. Nodes = source files (or modules); edges = "file A imports something from file B". Reuses the `imports` field that the parser already fills (`backend/parser/base.py` `FileResult.imports`).

---

## 1. What we already have

- [x] **Parser** populates `FileResult.imports`:
  - [x] `swiftParser.py:73` — appends `import_declaration` text.
  - [x] `pythonParser.py:38,45` — `import_statement` and `import_from_statement`.
  - [x] `javascriptParser.py:49,145` — ESM `import ... from '...'` and `require(...)`.
- [x] **IR JSON contract** reserves `files[].imports` (per `projekat.md` §1).
- [x] **Frontend view-switcher** (`viewLayouts`/`enterView` per-view layout cache) supports adding a third view without restructuring.

So: parser side is done, builder + API + UI is the new work.

---

## 2. Module resolution — the only hard problem

The `imports` strings as parsed are not directly comparable to file paths. We need to resolve `import "Foo"` (Swift) or `import x from './utils'` (JS) or `from app.services import db` (Python) to a concrete file in the repo. Resolution rules differ per language and are best-effort, not a full module resolver.

### Resolution strategy (per language)

**Swift**
- Most Swift `import` statements name modules (e.g. `Foundation`, `XCTest`, `Hydra`) — these are **external** and won't map to a file in the repo.
- For internal imports inside a single-package Swift repo (rare in single-target projects), there is no per-file import — Swift resolves at module level.
- Resolution: **map to a synthetic "external module" node** unless the import name matches a top-level type defined in the repo. Don't try to be clever.
- For Katana (the demo target): every import will be external — that's still useful, the dependency graph shows which files depend on which third-party modules.

**Python**
- `import foo.bar` and `from foo.bar import baz` → resolve `foo/bar.py` or `foo/bar/__init__.py` relative to repo root or to known package roots.
- Relative: `from .utils import x` inside `pkg/sub/mod.py` → `pkg/sub/utils.py`.
- Builtin modules (`os`, `sys`, `typing`) → external.
- Resolution: walk the repo once, build a `{module_dotted_path: file_path}` index from filenames. Look up each import against the index; unmatched → external.

**JavaScript/TypeScript**
- `import x from './utils'` → resolve relative to current file: try `./utils.js`, `./utils/index.js`, `./utils.ts`, etc.
- `import x from 'react'` → external (in `node_modules`).
- `import x from 'src/services/api'` (path aliases) → out of scope for v1; treat as external.
- Resolution: relative paths only for v1, with extension fallback `.js .jsx .ts .tsx /index.{js,ts}`.

**Java/Go (out of scope for v1)** — only ship Python/JS/Swift resolvers initially. The framework should be pluggable.

### Edge cases / caveats to document

- An import string that doesn't resolve gets attached to a synthetic external node `external:<name>`. We do **not** drop unresolved imports — the dependency graph wants to show them.
- A repo-internal file with no imports and that nothing imports is an isolated node — show it.
- The same target file imported multiple times (e.g. by two different `import` lines in the same source file) collapses to one edge with `weight = N`, mirroring the call-graph edge convention.

---

## 3. Backend changes

### 3.1 New module: `backend/ir_compiler/dependency_graph.py`

```python
def build_dependency_graph(ir_dict: dict) -> dict:
    """
    Input: the IR JSON produced by the parser (same shape consumed by build_call_graph).
    Output: a graph dict with the same top-level shape as the call graph, so the
            frontend can reuse its node/edge rendering pipeline.

    {
      "graph_id":  "<repo>-deps",
      "language":  "swift" | "python" | ...,
      "metadata":  { node_count, edge_count, external_count, internal_count, ... },
      "nodes":     [ FileNode, ... ],
      "edges":     [ ImportEdge, ... ]
    }
    """
```

**FileNode shape** (deliberately mirrors the call-graph node so the frontend can render it with minimal special-casing):

```json
{
  "id": "file:Sources/Katana/Store.swift",
  "type": "file",
  "name": "Store.swift",
  "path": "Sources/Katana/Store.swift",
  "kind": "internal",
  "language": "swift",
  "function_count": 7,
  "line_count": 220,
  "category": "source",
  "in_degree": 4,
  "out_degree": 2
}
```

External module:

```json
{
  "id": "external:Foundation",
  "type": "external",
  "name": "Foundation",
  "kind": "external",
  "in_degree": 12,
  "out_degree": 0
}
```

**ImportEdge shape**:

```json
{
  "source": "file:Sources/Katana/Store.swift",
  "target": "external:Foundation",
  "type": "imports",
  "weight": 1,
  "raw": "Foundation"
}
```

### 3.2 Resolver registry

```
backend/ir_compiler/resolvers/
    __init__.py        # registry: lang -> resolver
    base.py            # Resolver protocol: resolve(import_str, current_file, repo_files) -> str | None
    python.py
    javascript.py
    swift.py
```

The builder iterates files, looks up the resolver for `ir_dict["language"]`, and asks it to resolve each import. Unknown language → fall back to "everything is external".

### 3.3 New API endpoints (in `backend/api/main.py`)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/graph/{graph_id}/dependencies` | Full dependency graph JSON (same shape as call graph). |
| `GET` | `/graph/{graph_id}/dependencies/file/{file_id}` | `{ node, importers: [...], imports: [...] }` — analogous to `/node/{id}` for the call graph. |

Build lazily on first request; cache the result in memory keyed by `graph_id`. Invalidate when `/analyze` or `/upload` rebuilds the graph.

### 3.4 Hot path during `/analyze`

After `build_call_graph` runs, also compute `build_dependency_graph` and store both alongside each other. Adds <1s on a 5k-file repo (single pass over `files[].imports`).

### 3.5 Tests

- `backend/tests/dependency_graph_tests/`:
  - `test_python_resolver.py` — fixture repo with `pkg/a.py` importing `pkg.b`, relative imports, builtins.
  - `test_javascript_resolver.py` — relative imports with extension fallback, `index.js`, external from `node_modules`.
  - `test_swift_resolver.py` — confirms all imports go to `external:*` for the katana fixture.
  - `test_builder.py` — given a hand-crafted IR dict, asserts node/edge counts, weights, that an internal file with no imports/importers is an isolated node.

---

## 4. Frontend changes

### 4.1 New page: `frontend/src/pages/DependencyGraph.jsx`

- Mirrors `CallGraph.jsx`'s structure but renders file nodes instead of function nodes.
- Reuses the existing canvas/dagre layout pipeline. The store entry shape is compatible because the dependency graph node has `id`, `in_degree`, `out_degree` like a call-graph node.
- Side panel (when a file is selected): list of imports (outgoing) and importers (incoming), plus a button "Open in Call Graph" that filters the call graph to functions in this file.

### 4.2 Store wiring (`frontend/src/store/graphStore.js`)

- Add a `dependencyGraph` slice: `{ depNodes, depEdges, depLoading, depError }`.
- New action: `loadDependencyGraph(graphId)` — fetches `/graph/{id}/dependencies`, transforms once, stores. Independent of the call-graph slice so switching views doesn't refetch.
- Add `'dependency-graph'` as a third view key in `viewLayouts` / `viewCameras` so its dagre positions persist independently across navigations (matches the existing pattern).
- Hook `enterView('dependency-graph')` to run the same first-visit auto-layout we just wired for call graph and control flow.

### 4.3 Sidebar nav

- Add a third entry next to "Call Graph" / "Control Flow" — icon `account_tree` or `device_hub`, label "Dependencies", route `/workspace/dependency-graph`.
- Updates the `navLinks` array in the `Sidebar` component (currently in `CallGraph.jsx:1004` and `ControlFlow.jsx`).

### 4.4 Visual distinctions

- Internal file nodes: same surface treatment as call-graph nodes (`bg-white` card, `text-deep-olive`).
- External module nodes: dashed border + `bg-soft-sage/15` to read as "outside the codebase".
- Edges: solid for internal→internal, dashed for internal→external.
- Node click highlights immediate importers/imports (1-hop neighborhood) — same affordance as the call graph.

### 4.5 LLM integration (cheap win)

- Reuse `/llm/explain-node` by extending it on the backend to accept dependency-graph node IDs (`file:...`), feeding the file's path, function list, and imports to the LLM. UI surface is identical to the existing "Explain with AI" button on the inspector panel.
- Defer "Explain dependency edge" (why does A import B) to a stretch goal.

---

## 5. Phasing

### Phase 1 — backend skeleton (~1h)
- [ ] `dependency_graph.py` builder using a no-op resolver (everything external).
- [ ] Endpoint `/graph/{id}/dependencies` returning the graph JSON.
- [ ] One test against the katana fixture: every Swift import goes to `external:*`, edge weights look right.

### Phase 2 — resolvers (~2h)
- [ ] Python relative + absolute resolver with builtin filter.
- [ ] JS relative-path resolver with extension fallback.
- [ ] Swift resolver = always external (no work, just register).
- [ ] Per-resolver tests.

### Phase 3 — frontend view (~2-3h)
- [ ] `DependencyGraph.jsx` page + route.
- [ ] Store slice + `loadDependencyGraph` action + `enterView('dependency-graph')` wiring.
- [ ] Sidebar nav entry.
- [ ] Inspector panel: imports / importers list + "Open in Call Graph" link.

### Phase 4 — polish (~1h)
- [ ] External-vs-internal node styling (dashed border, edge style).
- [ ] 1-hop neighborhood highlight on selection.
- [ ] Wire `Explain with AI` for file nodes.
- [ ] Cluster mode for files: group by top-level directory (reuses existing cluster UI).

**Total: ~6-7h, single developer.** Phases 1+2 are independently shippable — even with phase 1 alone the demo gains a "what does this codebase depend on" view that's truthful for Swift.

---

## 6. Open questions to resolve before phase 3

- [ ] **Cluster grouping for the dependency view** — by top-level directory, or reuse the call-graph clusters (group files by which call-graph cluster their functions sit in)? Recommend top-level directory for v1 — simpler, more predictable.
- [ ] **Edge weight semantics** — count of import statements between files, or count of distinct symbols imported? V1: count of import statements; cheaper, matches what we have. Symbols would require a second parser pass.
- [ ] **Should external modules be collapsed into a single "external" group node** when there are >N of them, to avoid visual clutter? Decide after seeing katana rendered — likely yes for >20.
- [ ] **Cycles** — Python in particular allows import cycles. The builder should detect them via Tarjan SCC (we already use this for the call graph in `ir_compiler.py`) and surface them in `metadata.cycles` with the same shape, so the frontend's existing cycle highlight code can be reused without changes.

---

## 7. What this is NOT trying to solve

- Path aliases (`@/components/...`) in JS/TS — out of scope; treat as external.
- Re-export resolution (`export * from './a'`) — out of scope; the edge points to `./a` regardless of whether the symbol travels further.
- Dynamic imports (`import(...)` in JS, `importlib` in Python) — only handled if statically detectable as a string literal; otherwise ignored.
- Cross-language dependencies (a Python file calling a JS bundle via subprocess) — out of scope.

These are listed so we don't accidentally start building them.
