# CodePanel

**Owner:** Person D (UI + AI)

Sidebar that shows source code and AI summary for the selected node.

## Files to create

- `CodePanel.jsx` — sidebar container: source code viewer + AI summary below
- `AISummary.jsx` — displays AI-generated summary with loading state
- `index.js` — barrel export

## Behavior

- Opens when a node is clicked in GraphView
- Shows syntax-highlighted source code of the function
- "Summarize" button triggers `POST /api/ai/summarize` with the node's code + adjacent context
- Summary is cached per node (don't re-fetch on repeated clicks)
