# Mocks

Mock data so frontend can develop without the backend running.

## Files to create

- `graphData.js` — a realistic mock `CallGraph` with 8-10 nodes, various condition types, multiple files

## Usage

Import mock data in components during development. Switch to real API calls when backend is ready. TanStack Query makes this easy — just swap the query function.
