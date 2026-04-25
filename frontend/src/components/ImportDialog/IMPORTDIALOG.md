# ImportDialog

**Owner:** Person D (UI + AI)

Modal for importing a codebase — either from GitHub URL or local file upload.

## Files to create

- `ImportDialog.jsx` — modal wrapper with tab toggle between GitHub / Local
- `GitHubImport.jsx` — URL input + clone button
- `LocalImport.jsx` — drag-and-drop / file picker for local folders
- `index.js` — barrel export

## Behavior

- GitHub: user pastes repo URL → `POST /api/import { github_url }` → receives `project_id` → navigate to project page
- Local: user uploads files → `POST /api/import` as multipart form data → same flow
- Show loading state during clone/parse, error state on failure
