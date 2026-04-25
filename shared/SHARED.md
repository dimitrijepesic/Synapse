# Shared

Source of truth for the frontend-backend contract. Both sides reference this.

## Files

- `api_contract.md` — full API spec: endpoints, request/response JSON shapes, data models, error format

## Rules

- Any change here must be reflected in both `backend/app/models/graph.py` and `frontend/src/types/api.js`
- Discuss with the team before modifying — this is the glue between all 4 workstreams
