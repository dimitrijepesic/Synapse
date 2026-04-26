// Mock data removed — all graph data now comes from the backend via
// `loadGraph(graphId)` in `store/graphStore.js`. This module is kept as an
// empty shim to avoid breaking any stragglers; remove the file once you've
// confirmed nothing imports from it.

export const SOURCE_FILES = {};
export const defaultNodes = [];
export const defaultEdges = [];
export const defaultProject = { name: null, branch: null };
export const defaultFileTree = [];
export const defaultSelectedNodeId = null;
