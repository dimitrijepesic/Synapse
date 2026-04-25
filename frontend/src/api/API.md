# API Layer

**Owner:** Person D (UI + AI)

Fetch wrappers for all backend endpoints. All components call these instead of raw fetch.

## Files to create

- `client.js` — base fetch wrapper (base URL, error handling, JSON parsing)
- `graphApi.js` — `getGraph(projectId)` → `CallGraph`
- `nodeApi.js` — `getNode(id)`, `getAdjacentNodes(id)` → node data
- `importApi.js` — `importFromGitHub(url)`, `importLocal(files)` → `{ project_id }`
- `aiApi.js` — `summarizeNode(...)`, `aiInsertNode(...)` → AI responses

## Rules

- Base URL: `http://localhost:5000/api`
- All functions return promises matching the shapes in `shared/api_contract.md`
- Use these with TanStack Query in hooks/components for caching
