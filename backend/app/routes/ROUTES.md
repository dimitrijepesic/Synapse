# Routes

**Owner:** Person B (Backend API)

Flask blueprints exposing REST endpoints. Each file is one blueprint registered in `__init__.py`.

## Files to create

- `__init__.py` — registers all blueprints under `/api` prefix
- `import_repo.py` — `POST /api/import` (GitHub clone or file upload)
- `graph.py` — `GET /api/graph/<project_id>` (full call graph)
- `nodes.py` — `GET /api/node/<id>`, `GET /api/node/<id>/adjacent`
- `ai.py` — `POST /api/ai/summarize`, `POST /api/ai/insert`

## Rules

- All endpoints prefixed with `/api/`
- Return JSON, use the models from `app.models.graph`
- Error responses: `{"error": "...", "detail": "..."}` with proper HTTP status codes
- See `shared/api_contract.md` for exact request/response shapes
