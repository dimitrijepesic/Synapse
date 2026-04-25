// ─── Backend API Response Types (JSDoc) ─────────────────────────────────────
// Mirror of backend response shapes for frontend consumption.
// Source of truth: backend/api/main.py + backend/ir_compiler/ir_compiler.py

/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} type
 * @property {string} qualified_name
 * @property {string} name
 * @property {string} file
 * @property {number} line
 * @property {string} signature
 * @property {number} in_degree
 * @property {number} out_degree
 * @property {string} category
 * @property {string} [code_snippet]
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} source
 * @property {string} target
 * @property {string} type
 * @property {number} weight
 */

/**
 * @typedef {Object} GraphResponse
 * @property {string} graph_id
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 */

/**
 * @typedef {Object} NodeResponse
 * @property {GraphNode} node
 * @property {GraphNode[]} callers
 * @property {GraphNode[]} callees
 * @property {string} code_snippet
 */

/**
 * @typedef {Object} AffectedNode
 * @property {string} id
 * @property {number} distance
 * @property {number} risk_score
 * @property {string[]} path
 */

/**
 * @typedef {Object} PredictImpactResponse
 * @property {string} node_id
 * @property {AffectedNode[]} affected
 */

/**
 * @typedef {Object} HotspotsResponse
 * @property {string} name
 * @property {GraphNode[]} results
 */

/**
 * @typedef {Object} DeadCodeResponse
 * @property {string} name
 * @property {GraphNode[]} results
 */

/**
 * @typedef {Object} HealthResponse
 * @property {boolean} ok
 * @property {number} node_count
 * @property {number} edge_count
 * @property {number} cache_entries
 */

// ─── API Base URL ───────────────────────────────────────────────────────────

export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Endpoint paths ─────────────────────────────────────────────────────────

export const ENDPOINTS = {
  health: "/health",
  analyze: "/analyze",
  upload: "/upload",
  graph: (graphId) => `/graph/${graphId}`,
  node: (nodeId) => `/node/${nodeId}`,
  predictImpact: "/predict-impact",
  hotspots: "/query/hotspots",
  deadCode: "/query/dead_code",
  llmExplain: "/llm/explain-node",
  llmOverview: "/llm/overview",
  llmImpactNarrative: "/llm/impact-narrative",
  clusters: (graphId) => `/graph/${graphId}/clusters`,
  filterOptions: (graphId) => `/graph/${graphId}/filter-options`,
  filter: (graphId) => `/graph/${graphId}/filter`,
};
