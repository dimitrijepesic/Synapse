# Hooks

**Owner:** Person C (Graph Visualization)

Custom React hooks for graph-specific logic.

## Files to create

- `useNodeCache.js` — uses TanStack Query `prefetchQuery` to cache adjacent nodes on click (1 hop, 5 min TTL)
- `useGraphLayout.js` — computes dagre/elk layout from raw graph data, returns positioned nodes/edges for react-flow
