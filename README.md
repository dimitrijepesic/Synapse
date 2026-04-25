# Synapsis

Interactive call-graph explorer for Swift codebases. Map every function, every call, every dependency — then click any node to read the source, ask the AI what it does, or predict what breaks if you change it.

## How It Works

1. **Import** a Swift codebase from GitHub
2. **tree-sitter** parses the source via a pluggable language registry (Swift today, more languages drop in)
3. **Call graph** is built from the parsed IR — nodes are functions, edges are calls
4. **Interactive visualization** — explore the graph, click nodes to see source code and neighbors
5. **AI summaries** — Groq (Llama 3.3 70B) explains individual functions, summarizes the codebase, narrates impact predictions
6. **Deterministic queries** — predict impact, find hotspots and dead code with zero LLM calls

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + JavaScript |
| Graph viz | @xyflow/react |
| Frontend state | Zustand + TanStack Query |
| Backend | FastAPI (Python 3.12) |
| AST parsing | tree-sitter (Swift now, multi-language pluggable) |
| LLM | Groq (Llama 3.3 70B) via OpenAI-compatible SDK |
| LLM cache | SQLite |
| Storage | Filesystem (cloned repos in temp dirs, graphs as JSON) |

## Project Structure

```
backend/
  api/                    FastAPI app + endpoints
  ir_compiler/            IR → graph, predict_impact, hotspots, dead_code
  llm/                    Groq LLM provider, SQLite cache, use cases
  parser/                 tree-sitter parsing (Swift, multi-language registry)
  cached/                 Pre-built graph JSON (katana.graph.json)
  scripts/                Prefill and utility scripts
frontend/
  src/
    components/           GraphView, CodePanel, ImportDialog, NodeEditor, Layout
    api/                  Backend fetch wrappers
    store/                Zustand stores
    hooks/                Caching, layout
    types/                API type reference (JSDoc)
    mocks/                Mock data for frontend-only dev
```

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
cp ../.env.example ../.env
# edit ../.env and set LLM_API_KEY to your Groq key
uvicorn api.main:app --reload --port 8000
```

Server: `http://localhost:8000`
Swagger UI: `http://localhost:8000/docs`

Get a Groq API key at https://console.groq.com/keys (free tier).

### Frontend

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

## Team

| Person | Role | Owns |
|--------|------|------|
| **P1** | Swift Parser | `backend/parser/` — tree-sitter, language adapters, IR JSON output |
| **P2** | IR → Graph | `backend/ir_compiler/ir_compiler.py` — graph builder, predict_impact, hotspots, dead_code |
| **P3** | Backend API + LLM | `backend/api/` — FastAPI routes, Groq integration, SQLite cache |
| **P4** | Frontend | `frontend/` — React app, graph viz, code panel, node editor |

## Pipeline

```
Swift source ──▶ IR JSON ──▶ Graph JSON ──▶ HTTP API + LLM ──▶ React UI
   (P1)            (P2)         (P3)              (P3)          (P4)
```

Each stage has one owner and one output format. Mock-first development means each downstream stage hand-writes a fake input from the upstream stage and stays unblocked until the real one ships.

## API Contract

Source of truth is the Swagger UI at `/docs` on the running backend.

## Deployment

Deployed on Render free tier (Python native runtime). See `render.yaml` for the blueprint config.

- Persistent disk at `/var/data` holds `katana.graph.json` and `cache.sqlite`
- On first deploy, the app auto-seeds the graph JSON from the bundled copy in `backend/cached/`
- Set `LLM_API_KEY` manually in the Render dashboard

## Environment Variables

See `.env.example` for the full list. Key ones:

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | LLM provider (`groq` default; `openai`, `anthropic`, etc. supported) |
| `LLM_MODEL` | Model name (e.g. `llama-3.3-70b-versatile`) |
| `LLM_API_KEY` | API key for the chosen provider |
| `LLM_BASE_URL` | Base URL for OpenAI-compatible providers |
| `CACHE_PATH` | SQLite cache file path (default: `cache.sqlite`) |
| `GRAPH_PATH` | Path to graph JSON (default: `backend/cached/katana.graph.json`) |
| `FRONTEND_ORIGIN` | Frontend origin allowed by CORS |
