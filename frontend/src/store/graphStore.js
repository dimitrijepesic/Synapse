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

const useGraphStore = create((set, get) => ({
  nodes: defaultNodes,
  edges: defaultEdges,
  selectedNodeId: null,
  selectedFile: null,
  sourceFiles: {},
  graphId: null,
  loading: false,
  error: null,

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
      const firstSource = layoutNodes.find((n) => n.category === 'source')?.id || layoutNodes[0]?.id || null;

      set({
        nodes: layoutNodes,
        edges: rawEdges,
        selectedNodeId: firstSource,
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

  autoLayout: ({ animate = true } = {}) => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'LR',
      nodesep: 40,
      ranksep: 100,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach((n) => {
      g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });
    edges.forEach((e) => {
      if (e.source !== e.target) g.setEdge(e.source, e.target);
    });

    dagre.layout(g);

    const targets = {};
    nodes.forEach((n) => {
      const p = g.node(n.id);
      if (p) targets[n.id] = { x: Math.round(p.x - NODE_WIDTH / 2), y: Math.round(p.y - NODE_HEIGHT / 2) };
    });

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
