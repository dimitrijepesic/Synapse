# CodeGraph

Interactive AST-based call-graph explorer. Import a codebase, see which functions call which (and under what conditions), click to read code + AI summaries, and add new nodes to plan changes.

## How It Works

1. **Import** a repo (GitHub URL or local upload)
2. **tree-sitter** parses the AST across Python, JS/TS, Java, Go
3. **Call graph** is built — nodes are functions, edges are calls, labeled with conditions (if/else/for/try)
4. **Interactive visualization** — explore the graph, click nodes to see source code
5. **AI summaries** — Gemini 2.5 explains what each function does in context
6. **Modify** — add nodes manually or describe changes to AI, see the updated graph, run tests

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + JavaScript |
| Graph Viz | @xyflow/react |
| State | Zustand + TanStack Query |
| Backend | Flask (Python) |
| AST | tree-sitter (multi-language) |
| AI | Gemini 2.5 Flash |
| Storage | Filesystem (no database) |

## Project Structure

```
backend/          Flask API + AST engine
  app/
    routes/       REST endpoints
    services/     AST parser, call graph, AI, GitHub client
    models/       Shared data models (Node, Edge, Graph)
frontend/         React app
  src/
    components/   GraphView, CodePanel, ImportDialog, NodeEditor, Layout
    api/          Backend fetch wrappers
    store/        Zustand stores
    hooks/        Caching, layout
    types/        API type reference (JSDoc)
    mocks/        Mock data for frontend-only dev
shared/           API contract (source of truth for both sides)
```

## Setup

```bash
# Backend
cd backend
pip install -r requirements.txt
python run.py                    # http://localhost:5000

# Frontend
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

## Team

| Person | Role | What They Own |
|--------|------|---------------|
| **A** | AST Engine | tree-sitter parsing, call graph construction, language adapters, data models |
| **B** | Backend API | Flask routes, GitHub clone, test runner, code modifier |
| **C** | Graph Viz | react-flow graph, custom nodes/edges, layout, graph state |
| **D** | UI + AI | Import dialog, code panel, node editor, API layer, Gemini integration |

See `CLAUDE.md` for full conventions and `shared/api_contract.md` for the API spec.
