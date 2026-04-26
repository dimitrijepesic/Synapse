# `ir_compiler` v4 — what changed and how to exploit it

Source: `backend/ir_compiler/use.md` documents the v4 schema. Below: each upgrade since v3, what the frontend already does with it, and what's still on the table.

---

## A. Per-node enrichment fields (new in v4)

These all live on every node in the graph payload. The frontend currently picks up almost none of them.

### A1. `access_level` — `"public" | "open" | "internal" | "private" | "fileprivate"`

- **Currently used**: filter sidebar exposes it as a multi-select (`FilterPanel.jsx:294`). Nothing else.
- **Wins available**:
  - **Visual treatment on nodes**: a small lock badge for `private`/`fileprivate`, an outlined ring or `text-deep-olive` accent for `public`/`open`. Mirrors how IDEs hint visibility without reading code. Already have `iconFor` in `graphStore.js:330` doing crude `\bprivate\b` regex on the signature — replace with `access_level` so it works correctly when modifiers come before/around `func`.
  - **Inspector panel "API surface" line** — render `Public · override` next to the function signature. The inspector already has slots for analysis rows (`AnalysisRow`); this is one extra entry.
  - **Layered cluster view**: optional toggle "show only public API" — preselects the `access_level: ["public", "open"]` filter.
  - **Color the impact-narrative output**: when a high-impact node is `private`, downplay the warning ("internal change, contained"); when it's `public`, flag the public-API ripple. Pure prompt-engineering on the existing `/llm/impact-narrative` call.

### A2. `is_override` — bool

- **Currently used**: filter only.
- **Wins**:
  - **Edge styling**: a node with `is_override: true` could draw an extra `↳` glyph or a faint dashed connector to the parent definition. We don't have parent-class edges in the graph yet, but the badge alone is useful in the inspector ("Overrides parent implementation").
  - **Hotspot ranking tweak**: overrides of widely-implemented protocols are higher-risk to change than free functions of the same in-degree. The backend already weights hotspots; surfacing `is_override` in the inspector helps the user understand the score.

### A3. `protocol_witnesses` — `string[]`

- **Currently used**: not at all.
- **Wins** (this one is the most underused field):
  - **Inspector chip row**: render protocol names as small chips ("conforms `Equatable`", "conforms `ReturningTestSideEffect`"). Identical look to the existing `tags` row.
  - **Filter**: add a `protocol` SearchableMultiSelect to `FilterPanel` so the user can isolate "everything implementing `SideEffect`". Backend `/filter` would need a matching key — likely a one-line add since `protocol_witnesses` is already on the node.
  - **Cross-protocol view**: clicking a protocol chip shows all witnesses (siblings) and the default impl from `protocol_summary`. A "protocol map" without a new graph type — just a filtered call-graph view.
  - **AI explain prompt**: feed `protocol_witnesses` into the `/llm/explain-node` context. The LLM can then say "this is the dispatch implementation for `Reducer` conformance" without re-deriving it.

### A4. `complexity` — `{ param_count, call_count, line_span }`

- **Currently used**: `complexity: ''` is hardcoded to empty string in the node mapping (`graphStore.js:358`, `CallGraph.jsx:821`, `ControlFlow.jsx:869`). The backend ships the structured object; we throw it away.
- **Wins** (best ROI of the whole list):
  - **Replace `complexity: ''` with the real object** — one line in three places. From there:
    - **Node card density indicator**: a small bar or dot scale. e.g. `line_span > 80 || call_count > 15` → orange dot. Cheap, immediately visible.
    - **Sort/rank in the Functions sidebar tab**: add a "Sort by complexity" option using `line_span * 0.5 + call_count * 1`.
    - **Inspector stats**: `AnalysisRow label="Lines" value="42 (line_span)"`, `AnalysisRow label="Outbound calls" value=call_count`. We already render line ranges; expand it.
    - **AI summary prompt**: include `complexity` in the explain-node payload so the LLM can say "this 120-line method with 18 outbound calls is doing too much" rather than guessing from the snippet.
  - **Filter**: add a "Min line span" RangeFilter to `FilterPanel`. The backend filter likely already supports it (the IR has the field) — verify and surface.

### A5. `reachable_from_public_api` — bool

- **Currently used**: filter only.
- **Wins**:
  - **Dead-code overlay**: the existing `dead_code` query is one heuristic. Combine with `reachable_from_public_api === false && category === "source" && !synthetic` for a stricter "definitely unreachable" set — paint those nodes with a low-opacity treatment in the canvas. Use today's `iconFor` lock icon space.
  - **Refactor risk badge**: in the inspector, add a green "safe to refactor" pill when this is `false`. The backend has a `safe_to_refactor` query, but exposing the per-node flag avoids the round-trip and lets us shade nodes inline as the user scrolls.

### A6. `synthetic` — bool

- **Currently used**: `synthetic` is propagated through edges; node-level usage is in the FilterPanel only.
- **Wins**:
  - **Default-hide synthetic memberwise inits** behind a toggle (FilterPanel already has the switch — make the off state the default). Synthetic inits clutter the canvas in struct-heavy codebases like katana.
  - **Render synthetic nodes with a dashed outline** so when the user opts to see them, they're clearly "compiler-generated, not in source".

---

## B. Function-kind taxonomy (richer in v4)

`function_kind` ∈ `{constructor, destructor, protocol_default, static_method, test_case, test_lifecycle, test_helper, method}`. Already comes with display labels in `metadata.function_kinds[kind].label`.

- **Currently used**: filter (`function_kinds` multi-select). Nothing else.
- **Wins**:
  - **Replace `iconFor`**: the current logic in `graphStore.js:330-338` does ad-hoc regex against the signature for `init`, `private`, `override`. `function_kind` is the authoritative answer:
    - `constructor` → `add_circle`
    - `destructor` → `delete`
    - `test_case` → `science` (already done)
    - `test_lifecycle` → `playlist_play`
    - `test_helper` → `handyman`
    - `protocol_default` → `extension`
    - `static_method` → `bolt`
    - `method` → `code`
  - **Sidebar legend / overview panel**: read `metadata.function_kinds` (which has counts and human labels already) and render a horizontal stack: `Methods 142 · Tests 85 · Constructors 26 · …`. Zero domain logic needed; the labels are pre-computed.
  - **Cluster mode subtitles**: each cluster card already shows member count; add a one-line breakdown ("12 methods, 4 tests").

---

## C. Metadata block (new in v4)

The graph payload now ships a `metadata` object the frontend mostly ignores. Each sub-field is a feature waiting to be wired.

### C1. `metadata.entry_points` — node IDs of public + in_degree=0 nodes

- **Currently used**: nope.
- **Wins**:
  - **"Start exploring" rail**: a small panel listing entry points as buttons. Click → selects the node and fits the camera. This is the "where do I begin reading this codebase" affordance — perfect for the demo opening.
  - **Background layer in the canvas**: faintly highlight entry-point nodes with a sage glow border. Costs ~10 lines of CSS.

### C2. `metadata.connected_components` — `{count, largest_size, isolated_nodes}`

- **Currently used**: not used.
- **Wins**:
  - **Top-of-canvas health strip**: "1 main component (320 nodes), 4 isolated functions" — same UX shelf where filtered counts already live (`FilterPanel.jsx:268-277`).
  - **Auto-route to isolated nodes**: a button "Find isolated functions" that filters to the singleton components. Cheap dead-code finder distinct from the existing dead-code query.

### C3. `metadata.cycles` — `{count, largest_size, members[][]}`

- **Currently used**: not used. The frontend has `isMutualRecursive` derived locally for 2-cycles only.
- **Wins** (high signal per pixel):
  - **Cycle highlight overlay**: paint nodes in `cycles.members[i]` with a recurring loop badge; draw the cycle's edges in `text-rose-600` or similar warning color.
  - **"Cycles" button in left rail** alongside Hotspots / Dead Code, opens an inspector listing the top cycles with members and "Jump to cycle" buttons.
  - **AI cycle explainer**: per-cycle, prompt the LLM with the member signatures and ask "why might this circular dependency exist?" — reuses `/llm/explain-node`-style infra.

### C4. `metadata.test_coverage` — `{source_nodes, covered_by_tests, coverage_ratio}`

- **Currently used**: not used.
- **Wins**:
  - **Coverage ring** in the workspace header: a small SVG donut showing `coverage_ratio` plus tooltip explaining "static call-graph coverage proxy, not runtime coverage" (verbatim caveat from `use.md`).
  - **Per-node "uncovered" badge**: requires the backend to also expose per-node coverage, but if even just the aggregate is shown the demo gains a single number that says "this codebase tests 62% of its production code on paper". Strong narrative beat.

### C5. `metadata.protocol_summary` — `{name: {conformer_count, method_count}}`

- **Currently used**: not used.
- **Wins**:
  - **"Protocols" tab** in the side panel: list of protocols sorted by `conformer_count`. Click a protocol → filters call graph to its witnesses (uses A3 `protocol_witnesses` for the lookup).
  - **Architecture overview prompt**: feed top-N protocols by conformer count into the `/llm/overview` codebase summary so the AI's first paragraph mentions the actual extension points instead of guessing.

### C6. `metadata.category_counts` — `{source: 68, test: 85}`

- **Currently used**: not used.
- **Wins**: tiny — two-pill display somewhere in the header. Zero-cost UX hint that we're looking at a test-heavy or test-light codebase before the user even pans the canvas.

---

## D. Aggregated improvement priorities

Sorted by effort vs. visible payoff, hackathon-realistic.

- [ ] **1. Wire `complexity` end-to-end** — 5 lines of code change in three files; unlocks node density indicators, sortable function lists, better AI prompts. Free.
- [ ] **2. Replace `iconFor` with `function_kind` switch** — kills the ad-hoc signature regex; correct icons across all languages.
- [ ] **3. Inspector enrichment row**: render `access_level`, `is_override`, `protocol_witnesses` as chips. Pure UI work, ~30 LOC, no backend touch.
- [ ] **4. Metadata header strip**: read `metadata.{node_count, edge_count, category_counts, test_coverage.coverage_ratio}` into a one-row dashboard at the top of the canvas. Demo-friendly, ~50 LOC.
- [ ] **5. Cycle highlight** using `metadata.cycles.members` — replace the local `isMutualRecursive` 2-cycle hack with the real list, paint members + edges in warning color.
- [ ] **6. Entry-points side rail** — list `metadata.entry_points`, click to focus. Strong "where do I start" demo affordance.
- [ ] **7. Protocol panel** combining A3 + C5 — feed protocol witnesses into a sidebar; click to filter call graph to conformers.
- [ ] **8. AI prompt enrichment** — pass `complexity`, `access_level`, `protocol_witnesses`, `is_override`, `reachable_from_public_api` into `/llm/explain-node` and `/llm/overview` payloads. The LLM goes from "guessing from a snippet" to "reasoning over typed metadata". Highest qualitative jump for least effort.

Items 1, 2, 4, 8 together are probably ≤2 hours of work and noticeably level up both the canvas and the AI surfaces. Items 5, 6, 7 add ~3 hours but each is a self-contained feature suitable for a "v4 polish" PR.
