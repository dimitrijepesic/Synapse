# Graph Filter Feature — Frontend Implementation Guide

## What exists (backend, already done)

Two new endpoints have been added to `backend/api/main.py`:

### 1. `GET /graph/{graph_id}/filter-options`

Returns all distinct values for each filterable field. Use this to populate filter UI controls (dropdowns, checkboxes, etc.) when a graph is loaded.

**Response:**
```json
{
  "categories": ["source", "test", "util"],
  "function_kinds": ["constructor", "method", "static_method", "test_case", ...],
  "access_levels": ["public", "internal", "private", ...],
  "files": ["Sources/Store.swift", "Sources/State.swift", ...],
  "containers": ["Store", "State", "AppReducer", ...]
}
```

### 2. `POST /graph/{graph_id}/filter`

Accepts a JSON body with any combination of filters. All filters are optional — only supplied ones are applied with AND logic. Returns the filtered nodes and their connecting edges.

**Request body (`FilterRequest`):**
```json
{
  "categories": ["source"],
  "function_kinds": ["method", "constructor"],
  "access_levels": ["public", "internal"],
  "files": ["Sources/Store.swift"],
  "file_pattern": "Store",
  "containers": ["Store"],
  "name_pattern": "dispatch",
  "synthetic": false,
  "is_override": false,
  "reachable_from_public_api": true,
  "in_degree_min": 1,
  "in_degree_max": 50,
  "out_degree_min": 0,
  "out_degree_max": 20
}
```

All fields are optional. Omit any field (or set to `null`) to skip that filter.

**Response:**
```json
{
  "graph_id": "katana",
  "total_nodes": 153,
  "total_edges": 210,
  "filtered_nodes": 42,
  "filtered_edges": 38,
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

`nodes` and `edges` have the exact same schema as the full graph — they can be passed directly to react-flow.

## What to build (frontend)

### Filter Panel Component

Create a filter sidebar/panel component that:

1. **On graph load**, calls `GET /graph/{graph_id}/filter-options` to get all available values.
2. **Renders filter controls** for each dimension:
   - **Category** — checkbox group (`source`, `test`, `util`)
   - **Function Kind** — checkbox group or multi-select dropdown
   - **Access Level** — checkbox group (`public`, `internal`, `private`, etc.)
   - **File** — searchable multi-select dropdown (can have many values)
   - **File Pattern** — text input for substring search
   - **Container** — searchable multi-select dropdown
   - **Name Pattern** — text input for function name search
   - **Synthetic** — toggle/checkbox
   - **Is Override** — toggle/checkbox
   - **Reachable from Public API** — toggle/checkbox
   - **In-degree range** — two number inputs (min/max) or a range slider
   - **Out-degree range** — two number inputs (min/max) or a range slider
3. **On filter change**, sends `POST /graph/{graph_id}/filter` with only the active filters.
4. **Updates the graph visualization** with the filtered `nodes` and `edges`.
5. **Shows filter summary** — e.g. "Showing 42 of 153 nodes".

### Integration with existing graph view

- The filtered response has the same node/edge schema as the full graph, so existing react-flow rendering should work without changes.
- When all filters are cleared, either re-fetch the full graph via `GET /graph/{graph_id}` or send an empty filter body `{}` to `POST /graph/{graph_id}/filter` (returns everything).
- Consider debouncing the filter request (300ms) when text inputs change.

### Suggested file structure

```
frontend/src/components/FilterPanel/
  index.js          — barrel export
  FilterPanel.jsx   — main panel component
  FilterGroup.jsx   — reusable checkbox group
  RangeFilter.jsx   — min/max number input pair
  useFilterOptions.js — TanStack Query hook for GET /filter-options
  useFilteredGraph.js — TanStack Query mutation/hook for POST /filter
```

### API integration (TanStack Query)

```js
// useFilterOptions.js
import { useQuery } from '@tanstack/react-query';

export function useFilterOptions(graphId) {
  return useQuery({
    queryKey: ['filter-options', graphId],
    queryFn: () => fetch(`/api/graph/${graphId}/filter-options`).then(r => r.json()),
    enabled: !!graphId,
  });
}

// useFilteredGraph.js
import { useMutation } from '@tanstack/react-query';

export function useFilteredGraph(graphId) {
  return useMutation({
    mutationFn: (filters) =>
      fetch(`/api/graph/${graphId}/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      }).then(r => r.json()),
  });
}
```

Note: The backend runs on `http://localhost:5000` (check the Vite proxy config or use the full URL). CORS is already enabled for all origins.

### State management

Use Zustand (already in the project) to store the active filter state:

```js
// in existing store or new filter slice
filters: {},
setFilter: (key, value) => set(state => ({
  filters: { ...state.filters, [key]: value }
})),
clearFilters: () => set({ filters: {} }),
```

### UX considerations

- Show a "Clear all filters" button when any filter is active.
- Grey out / disable filter options that would produce zero results (optional, advanced).
- The filter panel should be collapsible to not obstruct the graph view.
- Show a badge/count on the filter button when filters are active.
