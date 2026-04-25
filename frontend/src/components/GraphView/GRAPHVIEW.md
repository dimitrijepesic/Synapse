# GraphView

**Owner:** Person C (Graph Visualization)

The core interactive call-graph canvas built on @xyflow/react (react-flow).

## Files to create

- `GraphView.jsx` — main react-flow canvas with zoom, pan, minimap
- `FunctionNode.jsx` — custom node: shows function name, file, language badge
- `ConditionEdge.jsx` — custom edge: labeled with the condition (if/else/for/etc.)
- `index.js` — barrel export

## Behavior

- Renders the full `CallGraph` as a directed graph
- Uses dagre or elkjs for automatic hierarchical layout
- Click a node → dispatch to store → CodePanel opens with that node's details
- Click a node → prefetch adjacent nodes via `useNodeCache`
- Edges show condition labels; different condition types get different colors/styles
