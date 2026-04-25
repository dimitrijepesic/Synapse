import { create } from 'zustand';
import dagre from 'dagre';
import { defaultNodes, defaultEdges } from '../data/mockData';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;
const LAYOUT_ANIM_MS = 500;

let layoutRaf = null;

// easeInOutCubic
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
import { API_BASE } from '../types/api';

const CLUSTER_NODE_WIDTH = 240;
const CLUSTER_NODE_HEIGHT = 140;

const useGraphStore = create((set, get) => ({
  nodes: defaultNodes,
  edges: defaultEdges,
  selectedNodeId: null,
  selectedFile: null,
  sourceFiles: {},
  graphId: null,
  loading: false,
  error: null,

  // Cluster state
  clusters: [],
  clusterEdges: [],
  nodeClusterMap: {},
  expandedClusters: new Set(),
  clusterView: false,  // false = flat view, true = package/cluster view
  clusterPositions: {},

  loadGraph: async (graphId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/graph/${graphId}`);
      if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
      const graph = await res.json();

      // Transform nodes to the frontend shape (same as mockData does)
      const SIG_FLAGS = ['override', 'private', 'fileprivate', 'public', 'static', 'class', 'mutating', 'throws', 'rethrows', 'async', 'final'];
      const tagsFromSignature = (sig) => {
        if (!sig) return [];
        const out = [];
        for (const flag of SIG_FLAGS) {
          if (new RegExp(`\\b${flag}\\b`).test(sig)) out.push(flag);
        }
        return out;
      };

      // Detect self-loops and mutual recursion
      const selfLoops = new Set();
      const mutualRec = new Set();
      const edgeKey = (s, t) => `${s}\u2192${t}`;
      const edgeSet = new Set(graph.edges.map((e) => edgeKey(e.source, e.target)));
      graph.edges.forEach((e) => {
        if (e.source === e.target) selfLoops.add(e.source);
        else if (edgeSet.has(edgeKey(e.target, e.source))) {
          mutualRec.add(e.source);
          mutualRec.add(e.target);
        }
      });

      const iconFor = (node, isSelfRecursive) => {
        if (node.category === 'test') return 'science';
        if (isSelfRecursive) return 'loop';
        const sig = node.signature || '';
        if (/\binit\b/.test(sig)) return 'add_circle';
        if (/\bprivate\b/.test(sig)) return 'lock';
        if (/\boverride\b/.test(sig)) return 'subdirectory_arrow_right';
        if (!node.container) return 'function';
        return 'code';
      };

      const describe = (n) => {
        if (n.category === 'test') return `XCTest case ${n.qualified_name}${n.return_type ? ` returning ${n.return_type}` : ''}.`;
        const where = n.container ? `Method on ${n.container}` : 'Top-level function';
        const ret = n.return_type ? ` returning ${n.return_type}` : '';
        const params = n.params && n.params.length ? `, ${n.params.length} parameter${n.params.length === 1 ? '' : 's'}` : '';
        return `${where} ${n.name}${ret}${params}.`;
      };

      const dependenciesFor = (n) => {
        const parts = [];
        if (n.container) parts.push(n.container);
        (n.params || []).forEach((p) => p.type && parts.push(p.type));
        return [...new Set(parts)].join(', ') || '-';
      };

      const sourceFiles = graph.source_files || {};
      const extractCode = (file, line, lineEnd, codeSnippet) => {
        const src = sourceFiles[file];
        if (!src) return codeSnippet || '';
        return src.split('\n').slice(line - 1, lineEnd).join('\n');
      };

      const rawNodes = graph.nodes.map((n) => ({
        id: n.id,
        functionName: n.name,
        filePath: n.file,
        complexity: '',
        tags: tagsFromSignature(n.signature),
        position: { x: 0, y: 0 },
        icon: iconFor(n, selfLoops.has(n.id)),
        code: extractCode(n.file, n.line, n.line_end, n.code_snippet) || '',
        startLine: n.line,
        highlightLine: n.line,
        analysis: {
          description: describe(n),
          dependencies: dependenciesFor(n),
          returnType: n.return_type || 'Void',
          executionTime: '-',
        },
        qualifiedName: n.qualified_name,
        signature: n.signature,
        params: n.params || [],
        returnType: n.return_type,
        container: n.container,
        inDegree: n.in_degree,
        outDegree: n.out_degree,
        category: n.category,
        lineEnd: n.line_end,
        isSelfRecursive: selfLoops.has(n.id),
        isMutualRecursive: mutualRec.has(n.id),
      }));

      const rawEdges = graph.edges.map((e, i) => ({
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        type: e.source === e.target ? 'loop' : (mutualRec.has(e.source) && mutualRec.has(e.target) ? 'loop' : 'normal'),
        sourceHandle: 'output',
        targetHandle: 'input',
        weight: e.weight,
      }));

      // Auto-layout (same BFS algorithm as mockData)
      const inDeg = {}, children = {};
      rawNodes.forEach((n) => { inDeg[n.id] = 0; children[n.id] = []; });
      rawEdges.forEach((e) => {
        if (e.source === e.target) return;
        inDeg[e.target] = (inDeg[e.target] || 0) + 1;
        if (children[e.source]) children[e.source].push(e.target);
      });
      const roots = rawNodes.filter((n) => !inDeg[n.id]);
      if (!roots.length && rawNodes.length) roots.push(rawNodes[0]);
      const depth = {}, visited = new Set();
      const queue = roots.map((n) => ({ id: n.id, d: 0 }));
      while (queue.length) {
        const { id, d } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        depth[id] = d;
        for (const c of children[id] || []) {
          if (!visited.has(c)) queue.push({ id: c, d: d + 1 });
        }
      }
      let maxD = Math.max(0, ...Object.values(depth));
      rawNodes.forEach((n) => { if (!visited.has(n.id)) depth[n.id] = ++maxD; });
      const layers = {};
      for (const [id, d] of Object.entries(depth)) (layers[d] = layers[d] || []).push(id);
      const H_GAP = 280, V_GAP = 150, START_X = 80, CENTER_Y = 400;
      const positions = {};
      for (const [d, ids] of Object.entries(layers)) {
        const totalH = (ids.length - 1) * V_GAP;
        const startY = CENTER_Y - totalH / 2;
        ids.forEach((id, i) => {
          positions[id] = { x: START_X + Number(d) * H_GAP, y: Math.round(startY + i * V_GAP) };
        });
      }

      const layoutNodes = rawNodes.map((n) => ({ ...n, position: positions[n.id] || { x: 0, y: 0 } }));

      set({
        nodes: layoutNodes,
        edges: rawEdges,
        selectedNodeId: null,
        selectedFile: null,
        sourceFiles,
        graphId: graphId,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e.message });
    }
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedFile: null }),
  selectFile: (filePath) => set({ selectedFile: filePath }),
  closeFile: () => set({ selectedFile: null }),

  getSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find((n) => n.id === selectedNodeId) || null;
  },

  addNode: (node) => {
    const id = `node-${Date.now()}`;
    set((state) => ({
      nodes: [...state.nodes, { ...node, id }],
      selectedNodeId: id,
    }));
    return id;
  },

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  moveNode: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n,
      ),
    })),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, { ...edge, id: `edge-${Date.now()}` }],
    })),

  removeEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    })),

  // --- Cluster actions ---

  loadClusters: async () => {
    const { graphId } = get();
    if (!graphId) return;
    try {
      const res = await fetch(`${API_BASE}/graph/${graphId}/clusters`);
      if (!res.ok) return;
      const data = await res.json();
      set({
        clusters: data.clusters || [],
        clusterEdges: data.cluster_edges || [],
        nodeClusterMap: data.node_cluster_map || {},
      });
      // Auto-layout clusters after loading
      get().layoutClusters();
    } catch (e) {
      console.warn('Failed to load clusters:', e);
    }
  },

  toggleClusterView: () => {
    const { clusterView, clusters, graphId } = get();
    const next = !clusterView;
    if (next && !graphId) return; // No graph loaded, can't show clusters
    if (next && clusters.length === 0 && graphId) {
      // Load clusters on first toggle
      set({ clusterView: next });
      get().loadClusters();
    } else {
      set({ clusterView: next, expandedClusters: new Set() });
      if (next) get().layoutClusters();
    }
  },

  toggleCluster: (clusterId) => {
    const { expandedClusters, clusters, nodes, nodeClusterMap } = get();
    const next = new Set(expandedClusters);
    if (next.has(clusterId)) {
      next.delete(clusterId);
    } else {
      next.add(clusterId);
    }
    set({ expandedClusters: next });
    // Re-layout to account for expanded cluster size
    get().layoutClusters();
  },

  layoutClusters: () => {
    const { clusters, clusterEdges, expandedClusters, nodes, nodeClusterMap } = get();
    if (clusters.length === 0) return;

    // Build a dagre graph of clusters
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    clusters.forEach((c) => {
      let w = CLUSTER_NODE_WIDTH;
      let h = CLUSTER_NODE_HEIGHT;
      if (expandedClusters.has(c.id)) {
        // Expanded clusters need more space based on node count
        const memberCount = c.node_ids.length;
        const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(memberCount))));
        const rows = Math.ceil(memberCount / cols);
        w = Math.max(CLUSTER_NODE_WIDTH, cols * (NODE_WIDTH + 24) + 48);
        h = Math.max(CLUSTER_NODE_HEIGHT, rows * (NODE_HEIGHT + 24) + 80);
      }
      g.setNode(c.id, { width: w, height: h });
    });

    clusterEdges.forEach((e) => {
      g.setEdge(e.source, e.target);
    });

    dagre.layout(g);

    const positions = {};
    const updatedNodes = [...nodes];

    clusters.forEach((c) => {
      const p = g.node(c.id);
      if (!p) return;
      const nodeInfo = g.node(c.id);
      const w = nodeInfo.width;
      const h = nodeInfo.height;
      positions[c.id] = {
        x: Math.round(p.x - w / 2),
        y: Math.round(p.y - h / 2),
        width: w,
        height: h,
      };

      // Position member nodes inside expanded clusters
      if (expandedClusters.has(c.id)) {
        const clusterX = positions[c.id].x;
        const clusterY = positions[c.id].y;
        const memberIds = c.node_ids;
        const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(memberIds.length))));
        const padX = 24;
        const padTop = 56; // room for cluster header
        const padBottom = 24;
        const gapX = 24;
        const gapY = 24;

        memberIds.forEach((nid, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const nx = clusterX + padX + col * (NODE_WIDTH + gapX);
          const ny = clusterY + padTop + row * (NODE_HEIGHT + gapY);
          const idx = updatedNodes.findIndex((n) => n.id === nid);
          if (idx >= 0) {
            updatedNodes[idx] = { ...updatedNodes[idx], position: { x: nx, y: ny } };
          }
        });
      }
    });

    set({ clusterPositions: positions, nodes: updatedNodes });
  },

  autoLayout: ({ animate = true } = {}) => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    // Split: connected nodes go to dagre, isolated nodes get grid-packed
    // separately so they don't form a tall vertical column.
    const connectedIds = new Set();
    edges.forEach((e) => {
      if (e.source !== e.target) {
        connectedIds.add(e.source);
        connectedIds.add(e.target);
      }
    });
    const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));
    const isolatedNodes = nodes.filter((n) => !connectedIds.has(n.id));

    const targets = {};
    let dagreBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    if (connectedNodes.length > 0) {
      const g = new dagre.graphlib.Graph();
      g.setGraph({
        rankdir: 'LR',
        nodesep: 40,
        ranksep: 100,
        marginx: 40,
        marginy: 40,
      });
      g.setDefaultEdgeLabel(() => ({}));

      connectedNodes.forEach((n) => {
        g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
      });
      edges.forEach((e) => {
        if (e.source !== e.target && connectedIds.has(e.source) && connectedIds.has(e.target)) {
          g.setEdge(e.source, e.target);
        }
      });

      dagre.layout(g);

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      connectedNodes.forEach((n) => {
        const p = g.node(n.id);
        if (!p) return;
        const x = Math.round(p.x - NODE_WIDTH / 2);
        const y = Math.round(p.y - NODE_HEIGHT / 2);
        targets[n.id] = { x, y };
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + NODE_WIDTH > maxX) maxX = x + NODE_WIDTH;
        if (y + NODE_HEIGHT > maxY) maxY = y + NODE_HEIGHT;
      });
      if (minX !== Infinity) dagreBounds = { minX, minY, maxX, maxY };
    }

    // Grid-pack isolated nodes to the right of the dagre cluster.
    if (isolatedNodes.length > 0) {
      const GAP_X = 24;
      const GAP_Y = 24;
      const startX = (connectedNodes.length > 0 ? dagreBounds.maxX + 80 : 40);
      const startY = (connectedNodes.length > 0 ? dagreBounds.minY : 40);
      // Aim for a roughly square block; cap columns so it doesn't go too wide.
      const cols = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(isolatedNodes.length))));
      isolatedNodes.forEach((n, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        targets[n.id] = {
          x: startX + c * (NODE_WIDTH + GAP_X),
          y: startY + r * (NODE_HEIGHT + GAP_Y),
        };
      });
    }

    if (!animate) {
      set((state) => ({
        nodes: state.nodes.map((n) => (targets[n.id] ? { ...n, position: targets[n.id] } : n)),
      }));
      return;
    }

    // Snapshot starting positions and tween to targets
    const starts = {};
    nodes.forEach((n) => { starts[n.id] = { x: n.position.x, y: n.position.y }; });

    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / LAYOUT_ANIM_MS);
      const k = ease(t);
      set((state) => ({
        nodes: state.nodes.map((n) => {
          const s = starts[n.id];
          const e = targets[n.id];
          if (!s || !e) return n;
          return {
            ...n,
            position: {
              x: Math.round(s.x + (e.x - s.x) * k),
              y: Math.round(s.y + (e.y - s.y) * k),
            },
          };
        }),
      }));
      if (t < 1) {
        layoutRaf = requestAnimationFrame(tick);
      } else {
        layoutRaf = null;
      }
    };
    layoutRaf = requestAnimationFrame(tick);
  },
}));

export default useGraphStore;
