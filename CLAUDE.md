# Synapsis — Project Conventions

## What This Is

AST-based call-graph explorer. Users import a codebase, we parse it with tree-sitter, build an interactive call graph showing which functions call which and under what conditions, and let users explore/modify it with AI assistance.

## Tech Stack

- **Frontend**: React + Vite + JavaScript
- **Backend**: Flask (Python)
- **AST Parsing**: tree-sitter (multi-language: Python, JS/TS, Java, Go)
- **Graph Viz**: @xyflow/react (react-flow)
- **State**: Zustand (frontend), TanStack Query (caching/prefetch)
- **AI**: Gemini 2.5 Flash (free tier) via google-generativeai
- **Storage**: Filesystem only (repos cloned to temp dirs, graphs in memory/JSON)
- **Dev**: Localhost only — no Docker, no hosting

### Shared contract (coordinate changes):
- `backend/app/models/graph.py` — Python dataclasses (Node, Edge, CallGraph)
- `frontend/src/types/api.js` — JS constants/JSDoc mirror of above
- `shared/api_contract.md` — API endpoint specs

## Conventions

- Backend routes are all under `/api/` prefix
- Flask uses blueprints — one per route file
- Frontend components use barrel exports (`index.js`)
- All functions/components have a clear single responsibility
- No code goes in without the owner's awareness if it's in their zone
- Keep PRs scoped to your workstream — cross-cutting changes go in separate PRs

## Running Locally

```bash
# Backend (Person A or B starts this)
cd backend
pip install -r requirements.txt
python run.py
# Runs on http://localhost:5000

# Frontend (Person C or D starts this)
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```
