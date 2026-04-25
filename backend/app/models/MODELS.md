# Models

**Owner:** Person A (AST Engine)

Python dataclasses defining the shared data contract. Both backend services and API routes import from here.

## Files to create

- `graph.py` — `GraphNode`, `GraphEdge`, `CallGraph` dataclasses
- `project.py` — `Project` metadata (id, path, languages detected)

## Rules

- These types are the **shared contract** — changes here affect everyone. Coordinate before modifying.
- Keep them as plain dataclasses with `asdict()` support for JSON serialization.
- Mirror any changes in `frontend/src/types/api.ts`.
