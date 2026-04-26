import { create } from 'zustand';
import dagre from 'dagre';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;
const COMPACT_NODE_WIDTH = 200;
const COMPACT_NODE_HEIGHT = 64;
const LAYOUT_ANIM_MS = 500;
const CLUSTER_ANIM_MS = 380;

let layoutRaf = null;
let clusterRaf = null;

// easeInOutCubic
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
import { API_BASE } from '../types/api';

// ── Cluster-mode layout tween ────────────────────────────────────────────
// Animates `nodes[].position` toward `nodeTargets` and `clusterPositions[id]`
// toward `clusterTargets` over CLUSTER_ANIM_MS. `clusterTargets` may include
// width/height — those interpolate too, so cluster cards smoothly resize on
// expand/collapse.
// Seed cluster card positions at the centroid of their member nodes' current
// positions, sized as a single node card. Used when entering cluster mode so
// each card visually "grows out of" the area where its members were sitting.
// Wrap tall dagre ranks into multiple sub-columns so the bounding box stays
// closer to square. dagre LR otherwise stacks every sibling at the same x,
// producing a tall narrow strip whenever one function fans out widely. We
// preserve dagre's within-rank order (which minimizes edge crossings) and
// only re-stack when the current aspect is below `targetAspect`.
function _balanceLayoutAspect(positions, opts = {}) {
  const ids = Object.keys(positions);
  if (ids.length < 4) return positions;

  const nodeW = opts.nodeW ?? NODE_WIDTH;
  const nodeH = opts.nodeH ?? NODE_HEIGHT;
  const gapX = opts.gapX ?? 80;
  const gapY = opts.gapY ?? 40;
  const targetAspect = opts.targetAspect ?? 1.0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ids.forEach((id) => {
    const p = positions[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + nodeW > maxX) maxX = p.x + nodeW;
    if (p.y + nodeH > maxY) maxY = p.y + nodeH;
  });
  const W = maxX - minX, H = maxY - minY;
  if (W <= 0 || H <= 0) return positions;
  if (W / H >= targetAspect * 0.9) return positions;

  const byRank = new Map();
  ids.forEach((id) => {
    const xKey = positions[id].x;
    if (!byRank.has(xKey)) byRank.set(xKey, []);
    byRank.get(xKey).push({ id, y: positions[id].y });
  });
  const ranks = [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, nodes]) => nodes.sort((a, b) => a.y - b.y));

  const subCols = ranks.map(() => 1);
  const aspectOf = () => {
    const totalCols = subCols.reduce((a, b) => a + b, 0);
    const maxRows = Math.max(...ranks.map((r, i) => Math.ceil(r.length / subCols[i])));
    return (totalCols * (nodeW + gapX)) / (maxRows * (nodeH + gapY));
  };

  let safety = 500;
  while (safety-- > 0 && aspectOf() < targetAspect) {
    let bestIdx = -1, bestRows = 0;
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i].length <= subCols[i]) continue;
      const rows = Math.ceil(ranks[i].length / subCols[i]);
      if (rows > bestRows) { bestRows = rows; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    subCols[bestIdx]++;
  }

  const midY = (minY + maxY) / 2;
  const out = {};
  let xCursor = minX;
  ranks.forEach((rankNodes, i) => {
    const k = subCols[i];
    const perCol = Math.ceil(rankNodes.length / k);
    const colHeight = (perCol - 1) * (nodeH + gapY) + nodeH;
    const colTop = midY - colHeight / 2;
    rankNodes.forEach((n, idx) => {
      const col = Math.floor(idx / perCol);
      const row = idx % perCol;
      out[n.id] = {
        x: Math.round(xCursor + col * (nodeW + gapX)),
        y: Math.round(colTop + row * (nodeH + gapY)),
      };
    });
    xCursor += k * (nodeW + gapX);
  });
  return out;
}

// Compute the auto-layout target positions for a graph (dagre on connected
// nodes, grid-pack on isolated). Pure: no store mutation. Returns
// { [nodeId]: {x, y} }.
function _computeAutoLayoutTargets(nodes, edges) {
  if (nodes.length === 0) return {};

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
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    connectedNodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    edges.forEach((e) => {
      if (e.source !== e.target && connectedIds.has(e.source) && connectedIds.has(e.target)) {
        g.setEdge(e.source, e.target);
      }
    });
    dagre.layout(g);

    const raw = {};
    connectedNodes.forEach((n) => {
      const p = g.node(n.id);
      if (!p) return;
      raw[n.id] = {
        x: Math.round(p.x - NODE_WIDTH / 2),
        y: Math.round(p.y - NODE_HEIGHT / 2),
      };
    });

    const balanced = _balanceLayoutAspect(raw);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.entries(balanced).forEach(([id, p]) => {
      targets[id] = p;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + NODE_WIDTH > maxX) maxX = p.x + NODE_WIDTH;
      if (p.y + NODE_HEIGHT > maxY) maxY = p.y + NODE_HEIGHT;
    });
    if (minX !== Infinity) dagreBounds = { minX, minY, maxX, maxY };
  }

  if (isolatedNodes.length > 0) {
    const GAP_X = 24, GAP_Y = 24;
    const startX = (connectedNodes.length > 0 ? dagreBounds.maxX + 80 : 40);
    const startY = (connectedNodes.length > 0 ? dagreBounds.minY : 40);
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

  return targets;
}

function _seedClusterPositionsFromMembers(clusters, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = {};
  clusters.forEach((c) => {
    let cx = 0, cy = 0, count = 0;
    c.node_ids.forEach((nid) => {
      const n = byId.get(nid);
      if (n) { cx += n.position.x; cy += n.position.y; count++; }
    });
    if (count === 0) return;
    cx /= count; cy /= count;
    out[c.id] = {
      x: Math.round(cx),
      y: Math.round(cy),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });
  return out;
}

function _tweenLayout({ nodeTargets, clusterTargets, onComplete }, set, get) {
  if (clusterRaf) cancelAnimationFrame(clusterRaf);

  const { nodes, clusterPositions } = get();
  const nodeStarts = {};
  nodes.forEach((n) => {
    if (nodeTargets[n.id]) nodeStarts[n.id] = { x: n.position.x, y: n.position.y };
  });
  const clusterStarts = {};
  Object.keys(clusterTargets).forEach((cid) => {
    const cur = clusterPositions[cid] || clusterTargets[cid];
    clusterStarts[cid] = {
      x: cur.x ?? clusterTargets[cid].x,
      y: cur.y ?? clusterTargets[cid].y,
      width: cur.width ?? clusterTargets[cid].width,
      height: cur.height ?? clusterTargets[cid].height,
    };
  });

  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / CLUSTER_ANIM_MS);
    const k = ease(t);

    set((state) => {
      const newNodes = state.nodes.map((n) => {
        const s = nodeStarts[n.id];
        const e = nodeTargets[n.id];
        if (!s || !e) return n;
        return {
          ...n,
          position: {
            x: Math.round(s.x + (e.x - s.x) * k),
            y: Math.round(s.y + (e.y - s.y) * k),
          },
        };
      });
      const newClusterPositions = { ...state.clusterPositions };
      Object.keys(clusterTargets).forEach((cid) => {
        const s = clusterStarts[cid];
        const e = clusterTargets[cid];
        newClusterPositions[cid] = {
          x: Math.round(s.x + (e.x - s.x) * k),
          y: Math.round(s.y + (e.y - s.y) * k),
          width: Math.round(s.width + (e.width - s.width) * k),
          height: Math.round(s.height + (e.height - s.height) * k),
        };
      });
      return { nodes: newNodes, clusterPositions: newClusterPositions };
    });

    if (t < 1) {
      clusterRaf = requestAnimationFrame(tick);
    } else {
      clusterRaf = null;
      if (onComplete) onComplete();
    }
  };
  clusterRaf = requestAnimationFrame(tick);
}

const CLUSTER_NODE_WIDTH = 240;
const CLUSTER_NODE_HEIGHT = 180;

const useGraphStore = create((set, get) => ({
  nodes: [],
  edges: [],
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
  // Snapshot of node positions in flat view, captured on first switch INTO
  // cluster mode. Used to tween nodes back to their flat layout when cluster
  // view is turned off.
  flatPositions: {},

    // Filter state
  filters: {},
  filterOptions: null,
  filterLoading: false,
  filteredCounts: null,  // { total_nodes, total_edges, filtered_nodes, filtered_edges }
  // Stash the full unfiltered graph so we can restore when filters are cleared
  _unfilteredNodes: null,
  _unfilteredEdges: null,

  // Per-view layout cache. Each top-level page (call-graph, control-flow) keeps
  // its own positions so autoLayout/moveNode in one view doesn't disturb the
  // other. activeView tracks which slice receives writes.
  activeView: null,
  viewLayouts: {},
  // Per-view camera (zoom + pan), so switching pages preserves the viewport.
  viewCameras: {},

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
        isHttpEndpoint: !!n.is_http_endpoint,
        decorators: n.decorators || [],
      }));

      const rawEdges = graph.edges.map((e, i) => ({
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        type: e.source === e.target ? 'loop' : (mutualRec.has(e.source) && mutualRec.has(e.target) ? 'loop' : 'normal'),
        sourceHandle: 'output',
        targetHandle: 'input',
        weight: e.weight,
        condition: e.condition || null,
        branch_kind: e.branch_kind || null,
        synthetic: e.synthetic || false,
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
        // New graph -> stale per-view caches, drop them so each view recomputes.
        viewLayouts: {},
        viewCameras: {},
      });
    } catch (e) {
      set({ loading: false, error: e.message });
    }
  },

  // Page-mount hook: tell the store which view is active and apply its cached
  // positions (or compute fresh if first visit).
  enterView: (viewKey) => {
    if (!viewKey) return;
    const { viewLayouts, nodes, edges, activeView } = get();
    if (activeView === viewKey && viewLayouts[viewKey]) {
      // Already on this view with cached positions — nothing to do.
      return;
    }
    const cached = viewLayouts[viewKey];
    if (cached) {
      set((state) => ({
        activeView: viewKey,
        nodes: state.nodes.map((n) => (cached[n.id] ? { ...n, position: cached[n.id] } : n)),
      }));
      return;
    }
    // First visit (or freshly-loaded graph): mark the view active and run the
    // animated dagre auto-layout so the BFS positions from `loadGraph` tween
    // into the proper dagre layout.
    set({ activeView: viewKey });
    if (nodes.length > 0) {
      get().autoLayout({ animate: true });
    }
  },

  setViewCamera: (viewKey, camera) => {
    if (!viewKey || !camera) return;
    set((state) => ({
      viewCameras: { ...state.viewCameras, [viewKey]: camera },
    }));
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
    set((state) => {
      const next = {
        nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
      };
      if (state.activeView) {
        const slice = state.viewLayouts[state.activeView] || {};
        next.viewLayouts = {
          ...state.viewLayouts,
          [state.activeView]: { ...slice, [id]: position },
        };
      }
      return next;
    }),

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
      const clusters = data.clusters || [];
      // Seed cards at member centroids so they animate out from their
      // original on-canvas region rather than popping into final dagre slots.
      const seed = _seedClusterPositionsFromMembers(clusters, get().nodes);
      set({
        clusters,
        clusterEdges: data.cluster_edges || [],
        nodeClusterMap: data.node_cluster_map || {},
        clusterPositions: seed,
      });
      get().layoutClusters({ animate: true });
    } catch (e) {
      console.warn('Failed to load clusters:', e);
    }
  },

  toggleClusterView: () => {
    const { clusterView, clusters, graphId, nodes } = get();
    const next = !clusterView;
    if (next && !graphId) return;

    if (next) {
      // Entering cluster mode — snapshot current flat positions for the
      // future "back to flat" tween, and seed cluster cards at member
      // centroids (small) so they grow into their dagre slots.
      const snapshot = {};
      nodes.forEach((n) => {
        snapshot[n.id] = { x: n.position.x, y: n.position.y };
      });
      const seed = clusters.length > 0 ? _seedClusterPositionsFromMembers(clusters, nodes) : {};
      set({
        clusterView: true,
        flatPositions: snapshot,
        expandedClusters: new Set(),
        clusterPositions: seed,
      });

      if (clusters.length === 0) {
        get().loadClusters();
      } else {
        get().layoutClusters({ animate: true });
      }
    } else {
      // Leaving cluster mode — recompute the auto-layout fresh and tween
      // nodes there (so the user lands in a tidy graph regardless of what
      // the flat snapshot was). Cluster cards shrink toward each member set's
      // centroid in the new layout, then unmount.
      const { clusters, edges, nodes } = get();
      const layoutTargets = _computeAutoLayoutTargets(nodes, edges);
      const targetNodes = Object.entries(layoutTargets).map(([id, p]) => ({ id, position: p }));
      const shrinkTargets = _seedClusterPositionsFromMembers(clusters, targetNodes);
      _tweenLayout({
        nodeTargets: layoutTargets,
        clusterTargets: shrinkTargets,
        onComplete: () => set({ clusterView: false, expandedClusters: new Set(), clusterPositions: {} }),
      }, set, get);
    }
  },

  toggleCluster: (clusterId) => {
    const { expandedClusters } = get();
    const next = new Set(expandedClusters);
    if (next.has(clusterId)) next.delete(clusterId);
    else next.add(clusterId);
    set({ expandedClusters: next });
    // Re-layout (animated) to account for the size change.
    get().layoutClusters({ animate: true });
  },

  layoutClusters: ({ animate = true } = {}) => {
    const { clusters, clusterEdges, expandedClusters } = get();
    if (clusters.length === 0) return;

    // ── Compute target cluster + node positions via dagre ──
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    clusters.forEach((c) => {
      let w = CLUSTER_NODE_WIDTH;
      let h = CLUSTER_NODE_HEIGHT;
      if (expandedClusters.has(c.id)) {
        const memberCount = c.node_ids.length;
        const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(memberCount))));
        const rows = Math.ceil(memberCount / cols);
        w = Math.max(CLUSTER_NODE_WIDTH, cols * (COMPACT_NODE_WIDTH + 24) + 48);
        h = Math.max(CLUSTER_NODE_HEIGHT, rows * (COMPACT_NODE_HEIGHT + 24) + 80);
      }
      g.setNode(c.id, { width: w, height: h });
    });

    clusterEdges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);

    const clusterTargets = {};
    const nodeTargets = {};

    clusters.forEach((c) => {
      const p = g.node(c.id);
      if (!p) return;
      const w = p.width;
      const h = p.height;
      const cx = Math.round(p.x - w / 2);
      const cy = Math.round(p.y - h / 2);
      clusterTargets[c.id] = { x: cx, y: cy, width: w, height: h };

      // For expanded clusters: lay member nodes out in a grid inside the box.
      // For collapsed clusters: park members at the cluster center so they
      // tween in cleanly the next time the cluster expands.
      const memberIds = c.node_ids;
      if (expandedClusters.has(c.id)) {
        const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(memberIds.length))));
        const padX = 24, padTop = 56, gapX = 24, gapY = 24;
        memberIds.forEach((nid, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          nodeTargets[nid] = {
            x: cx + padX + col * (COMPACT_NODE_WIDTH + gapX),
            y: cy + padTop + row * (COMPACT_NODE_HEIGHT + gapY),
          };
        });
      } else {
        const centerX = cx + w / 2 - COMPACT_NODE_WIDTH / 2;
        const centerY = cy + h / 2 - COMPACT_NODE_HEIGHT / 2;
        memberIds.forEach((nid) => {
          nodeTargets[nid] = { x: centerX, y: centerY };
        });
      }
    });

    if (!animate) {
      set((state) => ({
        clusterPositions: clusterTargets,
        nodes: state.nodes.map((n) => (nodeTargets[n.id] ? { ...n, position: nodeTargets[n.id] } : n)),
      }));
      return;
    }
    _tweenLayout({ nodeTargets, clusterTargets }, set, get);
  },

  autoLayout: ({ animate = true } = {}) => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    const targets = _computeAutoLayoutTargets(nodes, edges);

    const persistTargets = (state) => {
      if (!state.activeView) return state.viewLayouts;
      return { ...state.viewLayouts, [state.activeView]: { ...targets } };
    };

    if (!animate) {
      set((state) => ({
        nodes: state.nodes.map((n) => (targets[n.id] ? { ...n, position: targets[n.id] } : n)),
        viewLayouts: persistTargets(state),
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
        set((state) => ({ viewLayouts: persistTargets(state) }));
      }
    };
    layoutRaf = requestAnimationFrame(tick);
  },

  // --- Filter actions ---

  loadFilterOptions: async () => {
    const { graphId } = get();
    if (!graphId) return;
    try {
      const res = await fetch(`${API_BASE}/graph/${graphId}/filter-options`);
      if (!res.ok) return;
      const data = await res.json();
      set({ filterOptions: data });
    } catch (e) {
      console.warn('Failed to load filter options:', e);
    }
  },

  setFilter: (key, value) => set((state) => {
    const next = { ...state.filters };
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return { filters: next };
  }),

  clearFilters: () => {
    const { _unfilteredNodes, _unfilteredEdges } = get();
    const updates = { filters: {}, filteredCounts: null };
    if (_unfilteredNodes) {
      updates.nodes = _unfilteredNodes;
      updates.edges = _unfilteredEdges;
      updates._unfilteredNodes = null;
      updates._unfilteredEdges = null;
    }
    set(updates);
  },

  applyFilters: async () => {
    const { graphId, filters, nodes, edges, _unfilteredNodes } = get();
    if (!graphId) return;

    // Stash the full graph on first filter application
    if (!_unfilteredNodes) {
      set({ _unfilteredNodes: nodes, _unfilteredEdges: edges });
    }

    // If no active filters, restore the full graph
    if (Object.keys(filters).length === 0) {
      get().clearFilters();
      return;
    }

    set({ filterLoading: true });
    try {
      const res = await fetch(`${API_BASE}/graph/${graphId}/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!res.ok) throw new Error(`Filter failed: ${res.status}`);
      const data = await res.json();

      // The backend returns raw nodes/edges — transform them the same way loadGraph does
      const fullNodes = get()._unfilteredNodes || nodes;
      const filteredIds = new Set(data.nodes.map((n) => n.id));
      const filteredNodes = fullNodes.filter((n) => filteredIds.has(n.id));
      const filteredEdges = (get()._unfilteredEdges || edges).filter(
        (e) => filteredIds.has(e.source) && filteredIds.has(e.target)
      );

      set({
        nodes: filteredNodes,
        edges: filteredEdges,
        filterLoading: false,
        filteredCounts: {
          total_nodes: data.total_nodes,
          total_edges: data.total_edges,
          filtered_nodes: data.filtered_nodes,
          filtered_edges: data.filtered_edges,
        },
      });

      // Re-layout after filter
      get().autoLayout({ animate: true });
    } catch (e) {
      set({ filterLoading: false });
      console.warn('Filter error:', e);
    }
  },
}));

export default useGraphStore;
