import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Header, RepoFooter } from '../components/Layout';
import useGraphStore from '../store/graphStore';
import useProjectStore from '../store/projectStore';
import { API_BASE, ENDPOINTS } from '../types/api';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;

// --- Reachability classification ---
// "Unused" = isolated nodes with zero callers AND zero callees (no edges at all).
const isUnusedNode = (n) => (n.inDegree ?? 0) === 0 && (n.outDegree ?? 0) === 0;
const isEntryNode = (n) => (n.inDegree ?? 0) === 0;
const isLeafNode = (n) => (n.outDegree ?? 0) === 0;

const CANVAS_FILTERS = [
  { id: 'unused', label: 'Unused', match: isUnusedNode, dotClass: 'bg-rose-500' },
  { id: 'entry', label: 'Entry', match: isEntryNode, dotClass: 'bg-deep-olive' },
  { id: 'leaf', label: 'Leaf', match: isLeafNode, dotClass: 'bg-amber-500' },
];

// --- Edge path computation ---

function getHandlePosition(node, handleType) {
  const { x, y } = node.position;
  switch (handleType) {
    case 'input':
      return { x, y: y + NODE_HEIGHT / 2 };
    case 'output':
      return { x: x + NODE_WIDTH, y: y + NODE_HEIGHT / 2 };
    case 'output-top':
      return { x: x + NODE_WIDTH, y: y + NODE_HEIGHT * 0.3 };
    case 'output-bottom':
      return { x: x + NODE_WIDTH, y: y + NODE_HEIGHT * 0.7 };
    default:
      return { x, y: y + NODE_HEIGHT / 2 };
  }
}

const HANDLE_GAP = 0;
const EDGE_OFFSET = 40;
const CORNER_RADIUS = 12;

// Build an orthogonal path through `points` with rounded corners (quadratic Bézier).
function roundedOrthoPath(points, radius = CORNER_RADIUS) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const dx1 = Math.sign(curr.x - prev.x);
    const dy1 = Math.sign(curr.y - prev.y);
    const dx2 = Math.sign(next.x - curr.x);
    const dy2 = Math.sign(next.y - curr.y);
    const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    const ax = curr.x - dx1 * r;
    const ay = curr.y - dy1 * r;
    const bx = curr.x + dx2 * r;
    const by = curr.y + dy2 * r;
    d += ` L ${ax} ${ay} Q ${curr.x} ${curr.y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function computeEdgePath(source, target) {
  const sx = source.x;
  const sy = source.y;
  const tx = target.x - HANDLE_GAP;
  const ty = target.y;

  if (tx > sx + EDGE_OFFSET) {
    // Target is to the right — simple S-curve through midpoint
    const midX = Math.round((sx + tx) / 2);
    return roundedOrthoPath([
      { x: sx, y: sy },
      { x: midX, y: sy },
      { x: midX, y: ty },
      { x: tx, y: ty },
    ]);
  }

  // Target is behind or directly below/above — route around nodes
  const outX = sx + EDGE_OFFSET;
  const inX = tx - EDGE_OFFSET;
  const bypassY = sy > ty
    ? Math.min(sy, ty) - EDGE_OFFSET
    : Math.max(sy, ty) + EDGE_OFFSET;
  return roundedOrthoPath([
    { x: sx, y: sy },
    { x: outX, y: sy },
    { x: outX, y: bypassY },
    { x: inX, y: bypassY },
    { x: inX, y: ty },
    { x: tx, y: ty },
  ]);
}

function computeArrowHead(target) {
  const s = 5;
  const tipX = target.x - HANDLE_GAP;
  return `M ${tipX - s} ${target.y - s} L ${tipX} ${target.y} L ${tipX - s} ${target.y + s}`;
}

function getEdgeClasses(edge, selectedNodeId) {
  const classes = ['connection-line'];
  const touchesSelected = edge.source === selectedNodeId || edge.target === selectedNodeId;
  if (touchesSelected) classes.push('active');
  else if (selectedNodeId) classes.push('dimmed');
  if (edge.type === 'if') classes.push('condition-if');
  if (edge.type === 'error') classes.push('condition-error');
  if (edge.type === 'loop') classes.push('condition-loop');
  return classes.join(' ');
}

// Small loop arc above a node for source === target self-recursion
function computeSelfLoopPath(node) {
  const cx = node.position.x + NODE_WIDTH / 2;
  const top = node.position.y;
  const r = 22;
  const startX = cx - r;
  const endX = cx + r;
  const ay = top - 30;
  return `M ${startX} ${top} C ${startX} ${ay}, ${endX} ${ay}, ${endX} ${top}`;
}

function computeSelfLoopArrow(node) {
  const cx = node.position.x + NODE_WIDTH / 2;
  const endX = cx + 22;
  const top = node.position.y;
  const s = 4;
  return `M ${endX - s} ${top - s} L ${endX} ${top} L ${endX + s} ${top - s}`;
}

// --- Branch-kind visual styling for Control Flow edges ---

const BRANCH_STYLES = {
  if_then:     { color: '#16a34a', label: 'if'    }, // green
  if_else:     { color: '#dc2626', label: 'else'  }, // red
  guard_else:  { color: '#ea580c', label: 'guard' }, // orange
  switch_case: { color: '#2563eb', label: 'case'  }, // blue
};

function edgeStrokeStyle(edge) {
  const s = edge.branch_kind ? BRANCH_STYLES[edge.branch_kind] : null;
  if (!s) return undefined;
  return { stroke: s.color, strokeWidth: 2 };
}

function midpointOf(from, to) {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function ConditionLabel({ from, to, edge }) {
  if (!edge.condition) return null;
  const { x, y } = midpointOf(from, to);
  const color = edge.branch_kind ? BRANCH_STYLES[edge.branch_kind].color : '#374151';
  const text = edge.condition;
  // Estimate width crudely so background sits behind the text
  const charW = 6.2;
  const padX = 6;
  const w = Math.max(28, text.length * charW + padX * 2);
  const h = 18;
  return (
    <g pointerEvents="none">
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={4}
        ry={4}
        fill="white"
        stroke={color}
        strokeWidth={1}
        opacity={0.95}
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fill={color}
        style={{ fontSize: 11, fontFamily: 'inherit', fontWeight: 500 }}
      >
        {text}
      </text>
    </g>
  );
}

// --- Main Control Flow page ---

export default function ControlFlow() {
  const { nodes, edges, selectedNodeId, selectedFile, selectNode, selectFile, closeFile, moveNode, addNode, addEdge, autoLayout, loadGraph, enterView, sourceFiles, loading: graphLoading, error: graphError, graphId, clusters, clusterEdges, nodeClusterMap, expandedClusters, clusterView, clusterPositions, toggleClusterView, toggleCluster, viewCameras, setViewCamera, viewLayouts } = useGraphStore();
  const { project, ui, openNodeEditor, closeNodeEditor, toggleCodePanel, setActiveSideTab, setProject } = useProjectStore();
  const [searchParams] = useSearchParams();

  // Load graph from API if graph_id is in the URL
  useEffect(() => {
    const qGraphId = searchParams.get('graph_id');
    if (qGraphId && qGraphId !== graphId) {
      loadGraph(qGraphId);
      setProject({ name: qGraphId, branch: 'main' });
    }
  }, [searchParams]);

  // Apply this view's cached layout (or compute fresh on first visit) so the
  // control-flow layout stays independent of the call-graph page.
  useEffect(() => {
    enterView('control-flow');
  }, [enterView, graphId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  // Unused-node visibility: hidden by default, user can toggle to show
  const [showUnusedNodes, setShowUnusedNodes] = useState(false);

  // Codebase overview state
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // Hotspots state
  const [hotspotsData, setHotspotsData] = useState(null);
  const [hotspotsLoading, setHotspotsLoading] = useState(false);

  // Dead code state
  const [deadCodeData, setDeadCodeData] = useState(null);
  const [deadCodeLoading, setDeadCodeLoading] = useState(false);

  const handleOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    setOverviewOpen(true);
    try {
      const res = await fetch(`${API_BASE}${ENDPOINTS.llmOverview}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Overview failed: ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }
      const data = await res.json();
      setOverview(data.overview || '(empty response)');
    } catch (err) {
      setOverviewError(err.message || 'Failed to get overview');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const handleHotspots = useCallback(async () => {
    setHotspotsLoading(true);
    try {
      const res = await fetch(`${API_BASE}${ENDPOINTS.hotspots}`);
      if (!res.ok) throw new Error(`Hotspots failed: ${res.status}`);
      const data = await res.json();
      setHotspotsData(data.results || []);
    } catch (err) {
      setHotspotsData(null);
    } finally {
      setHotspotsLoading(false);
    }
  }, []);

  const handleDeadCode = useCallback(async () => {
    setDeadCodeLoading(true);
    try {
      const res = await fetch(`${API_BASE}${ENDPOINTS.deadCode}`);
      if (!res.ok) throw new Error(`Dead code failed: ${res.status}`);
      const data = await res.json();
      setDeadCodeData(data.results || []);
    } catch (err) {
      setDeadCodeData(null);
    } finally {
      setDeadCodeLoading(false);
    }
  }, []);

  // Direct neighbors (callers + callees) of the selected node — used for highlighting
  const neighborIds = (() => {
    if (!selectedNodeId) return null;
    const set = new Set([selectedNodeId]);
    for (const e of edges) {
      if (e.source === selectedNodeId) set.add(e.target);
      if (e.target === selectedNodeId) set.add(e.source);
    }
    return set;
  })();

  // Canvas-level classification filter (Dead / Entry / Leaf). Independent of
  // the side-panel function filter; controls dimming on the graph itself.
  const [classFilter, setClassFilter] = useState(() => new Set());
  const toggleClassFilter = useCallback((id) => {
    setClassFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const matchesClassFilter = useCallback((node) => {
    if (classFilter.size === 0) return true;
    for (const f of CANVAS_FILTERS) {
      if (classFilter.has(f.id) && f.match(node)) return true;
    }
    return false;
  }, [classFilter]);

  // Visible nodes: hide unused (0-in, 0-out) nodes unless toggled on
  const visibleNodes = useMemo(
    () => (showUnusedNodes ? nodes : nodes.filter((n) => !isUnusedNode(n))),
    [nodes, showUnusedNodes],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [edges, visibleNodeIds],
  );
  // O(1) lookup for edge endpoint resolution (replaces per-edge .find scan)
  const visibleNodeById = useMemo(() => {
    const m = new Map();
    for (const n of visibleNodes) m.set(n.id, n);
    return m;
  }, [visibleNodes]);

  // --- Zoom / Pan state (persisted per view in graphStore.viewCameras) ---
  const canvasRef = useRef(null);
  const initialCam = viewCameras['control-flow'];
  const [zoom, setZoom] = useState(initialCam?.zoom ?? 1);
  const [pan, setPan] = useState(initialCam?.pan ?? { x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  // Persist camera whenever it changes
  useEffect(() => {
    setViewCamera('control-flow', { zoom, pan });
  }, [zoom, pan, setViewCamera]);

  // Track canvas dimensions reactively
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    if (graphLoading || graphError) return;
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [graphLoading, graphError]);

  // After a graph loads and enterView populates the dagre cache, fit the
  // viewport to the graph so the user sees the whole layout instead of an
  // off-screen mess. Gated on viewLayouts['control-flow'] so we read post-dagre
  // positions, not the transient BFS positions from loadGraph.
  const fittedGraphId = useRef(null);
  const controlFlowLayout = viewLayouts['control-flow'];
  useEffect(() => {
    if (!graphId || graphLoading || graphError) return;
    if (fittedGraphId.current === graphId) return;
    if (!controlFlowLayout || Object.keys(controlFlowLayout).length === 0) return;
    if (canvasSize.w === 0 || canvasSize.h === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    for (const [id, p] of Object.entries(controlFlowLayout)) {
      if (!visibleIds.has(id)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + NODE_WIDTH > maxX) maxX = p.x + NODE_WIDTH;
      if (p.y + NODE_HEIGHT > maxY) maxY = p.y + NODE_HEIGHT;
    }
    if (minX === Infinity) return;

    const PADDING = 60;
    const graphW = maxX - minX + 2 * PADDING;
    const graphH = maxY - minY + 2 * PADDING;
    const z = Math.max(0.15, Math.min(1, canvasSize.w / graphW, canvasSize.h / graphH));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(z);
    setPan({ x: canvasSize.w / 2 - cx * z, y: canvasSize.h / 2 - cy * z });
    fittedGraphId.current = graphId;
  }, [graphId, graphLoading, graphError, controlFlowLayout, visibleNodes, canvasSize.w, canvasSize.h]);

  // Wheel: pinch-to-zoom (ctrlKey) or two-finger-scroll to pan
  useEffect(() => {
    if (graphLoading || graphError) return;
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const z = zoomRef.current;
      const p = panRef.current;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom on trackpad (or ctrl+scroll with mouse)
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const step = -e.deltaY * 0.01;
        const next = Math.max(0.15, Math.min(2.5, z + step));
        const ratio = next / z;
        setZoom(next);
        setPan({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio });
      } else {
        // Two-finger scroll → pan
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [graphLoading, graphError]);

  // Canvas mousedown: pan (drag) or deselect (click)
  const handleCanvasMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.node-card') || e.target.closest('button') || e.target.closest('aside')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPan = { ...panRef.current };
      let moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        setPan({ x: startPan.x + dx, y: startPan.y + dy });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        if (!moved) selectNode(null);
      };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectNode],
  );

  // Keyboard shortcut: Escape closes node editor
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') closeNodeEditor();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeNodeEditor]);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleFileOpen = useCallback((filePath) => {
    selectFile(filePath);
    if (!ui.codePanelOpen) toggleCodePanel();
  }, [selectFile, ui.codePanelOpen, toggleCodePanel]);

  const centerOnNode = useCallback((nodeId) => {
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const cx = target.position.x + NODE_WIDTH / 2;
    const cy = target.position.y + NODE_HEIGHT / 2;
    const z = zoomRef.current;
    setPan({ x: canvasSize.w / 2 - cx * z, y: canvasSize.h / 2 - cy * z });
  }, [nodes, canvasSize.w, canvasSize.h]);

  const handleFunctionSelect = useCallback((nodeId) => {
    selectNode(nodeId);
    if (!ui.codePanelOpen) toggleCodePanel();
    centerOnNode(nodeId);
  }, [selectNode, ui.codePanelOpen, toggleCodePanel, centerOnNode]);

  // Viewport culling: only render nodes/edges that intersect the visible
  // canvas (with a buffer so they don't pop in mid-pan). Selected node is
  // always kept so highlight survives panning.
  const VIEWPORT_BUFFER = 300;
  const viewportBounds = useMemo(() => {
    const buf = VIEWPORT_BUFFER / zoom;
    const minX = -pan.x / zoom;
    const minY = -pan.y / zoom;
    return {
      minX: minX - buf,
      minY: minY - buf,
      maxX: minX + canvasSize.w / zoom + buf,
      maxY: minY + canvasSize.h / zoom + buf,
    };
  }, [pan.x, pan.y, zoom, canvasSize.w, canvasSize.h]);

  const viewportNodes = useMemo(() => {
    const out = [];
    const { minX, minY, maxX, maxY } = viewportBounds;
    for (const n of visibleNodes) {
      const x = n.position.x;
      const y = n.position.y;
      if (
        n.id === selectedNodeId ||
        (x + NODE_WIDTH >= minX && x <= maxX && y + NODE_HEIGHT >= minY && y <= maxY)
      ) {
        out.push(n);
      }
    }
    return out;
  }, [visibleNodes, viewportBounds, selectedNodeId]);

  const viewportNodeIds = useMemo(() => new Set(viewportNodes.map((n) => n.id)), [viewportNodes]);

  const viewportEdges = useMemo(
    () => visibleEdges.filter((e) => viewportNodeIds.has(e.source) || viewportNodeIds.has(e.target)),
    [visibleEdges, viewportNodeIds],
  );

  // Stable id-based handlers — avoids fresh inline arrows on every render
  // breaking React.memo on NodeCard / CompactNodeCard
  const handleNodeSelect = useCallback((id) => selectNode(id), [selectNode]);
  const handleNodeOpenCode = useCallback((id) => handleFunctionSelect(id), [handleFunctionSelect]);
  const handleNodeMove = useCallback((id, pos) => moveNode(id, pos), [moveNode]);

  // Esc closes the file overlay (in addition to the node editor)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && selectedFile) closeFile();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedFile, closeFile]);

  if (graphLoading) {
    return (
      <div className="flex flex-col h-screen font-body-md text-body-md text-on-surface overflow-hidden items-center justify-center" style={{ backgroundColor: '#f9fafb' }}>
        <Header activePage="control-flow" />
        <div className="flex flex-col items-center gap-4 pt-20">
          <span className="material-symbols-outlined text-[48px] text-deep-olive animate-spin">progress_activity</span>
          <p className="text-gray-600 text-lg">Loading graph...</p>
        </div>
      </div>
    );
  }

  if (graphError) {
    return (
      <div className="flex flex-col h-screen font-body-md text-body-md text-on-surface overflow-hidden items-center justify-center" style={{ backgroundColor: '#f9fafb' }}>
        <Header activePage="control-flow" />
        <div className="flex flex-col items-center gap-4 pt-20">
          <span className="material-symbols-outlined text-[48px] text-red-500">error</span>
          <p className="text-red-600 text-lg">{graphError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen font-body-md text-body-md text-on-surface overflow-hidden" style={{ backgroundColor: '#f9fafb' }}>
      <Header activePage="control-flow" />

      <div className="flex flex-1 pt-14 sm:pt-16 min-h-0 overflow-hidden">
        {/* Sidebar — icon rail + expandable explorer panel */}
        <SideNav
          activePage="control-flow"
          project={project}
          graphId={graphId}
          activeTab={ui.activeSideTab}
          onTabChange={(tab) => setActiveSideTab(ui.activeSideTab === tab ? null : tab)}
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          selectedFile={selectedFile}
          onFileOpen={handleFileOpen}
          onFunctionSelect={handleFunctionSelect}
          onOverview={handleOverview}
          overviewLoading={overviewLoading}
          onHotspots={handleHotspots}
          hotspotsLoading={hotspotsLoading}
          onDeadCode={handleDeadCode}
          deadCodeLoading={deadCodeLoading}
          showUnusedNodes={showUnusedNodes}
          onToggleUnused={() => setShowUnusedNodes((v) => !v)}
          unusedCount={nodes.filter(isUnusedNode).length}
          classFilter={classFilter}
          onToggleClassFilter={toggleClassFilter}
          onClearClassFilter={() => setClassFilter(new Set())}
          visibleNodes={visibleNodes}
        />

        <main className="flex-1 flex min-h-0 relative">
          {/* Top-left toolbar: Auto Layout + Packages */}
          <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-10 flex items-center gap-2">
            <button
              onClick={() => autoLayout()}
              className="glass-panel rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
              title="Auto layout nodes"
            >
              <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
              <span className="font-label-sm">Auto Layout</span>
            </button>
            <button
              onClick={toggleClusterView}
              className={`rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors border ${
                clusterView
                  ? 'bg-deep-olive text-white border-deep-olive hover:opacity-90 shadow-sm'
                  : 'glass-panel text-gray-500 hover:text-gray-900 border-transparent'
              }`}
              title={clusterView ? 'Switch to flat view' : 'Switch to package view'}
            >
              <span
                className="material-symbols-outlined text-[16px]"
                style={clusterView ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {clusterView ? 'check' : 'package_2'}
              </span>
              <span className="font-label-sm">{clusterView ? 'Packaged' : 'Packages'}</span>
            </button>
            <div className="glass-panel rounded-lg px-2 py-1 flex items-center gap-2" title="Branch kinds">
              {Object.entries(BRANCH_STYLES).map(([kind, s]) => (
                <span key={kind} className="flex items-center gap-1 text-[11px] text-gray-600">
                  <span className="inline-block w-2.5 h-0.5 rounded" style={{ backgroundColor: s.color }} />
                  <span className="font-label-sm">{s.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className="flex-1 node-canvas-bg relative overflow-hidden h-full"
            style={{ cursor: 'grab' }}
            onMouseDown={handleCanvasMouseDown}
          >
            {/* Transform wrapper — everything inside zooms/pans together */}
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>

              {clusterView ? (
                <>
                  {/* === CLUSTER / PACKAGE VIEW === */}

                  {/* Cluster-level edges */}
                  <svg className="absolute pointer-events-none" style={{ top: 0, left: 0, width: 8000, height: 8000, overflow: 'visible' }}>
                    {clusterEdges.map((ce, i) => {
                      const sp = clusterPositions[ce.source];
                      const tp = clusterPositions[ce.target];
                      if (!sp || !tp) return null;
                      const from = { x: sp.x + sp.width, y: sp.y + sp.height / 2 };
                      const to = { x: tp.x, y: tp.y + tp.height / 2 };
                      return (
                        <g key={`ce-${i}`}>
                          <path
                            className="connection-line"
                            d={computeEdgePath(from, to)}
                            style={{ strokeWidth: Math.min(4, 1 + ce.weight * 0.5), opacity: 0.5 }}
                          />
                          <path
                            className="connection-line"
                            d={computeArrowHead(to)}
                            style={{ opacity: 0.5 }}
                          />
                          {ce.weight > 1 && (
                            <text
                              x={(from.x + to.x) / 2}
                              y={(from.y + to.y) / 2 - 8}
                              textAnchor="middle"
                              className="fill-gray-400"
                              style={{ fontSize: 10, fontFamily: 'inherit' }}
                            >
                              {ce.weight}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* Edges between nodes in expanded clusters */}
                    {viewportEdges.map((edge) => {
                      const srcCluster = nodeClusterMap[edge.source];
                      const tgtCluster = nodeClusterMap[edge.target];
                      // Only show node-level edges if both ends are in expanded clusters
                      const srcExpanded = srcCluster && expandedClusters.has(srcCluster);
                      const tgtExpanded = tgtCluster && expandedClusters.has(tgtCluster);
                      if (!srcExpanded && !tgtExpanded) return null;

                      const sourceNode = visibleNodeById.get(edge.source);
                      const targetNode = visibleNodeById.get(edge.target);
                      if (!sourceNode || !targetNode) return null;

                      if (edge.source === edge.target) {
                        return (
                          <g key={edge.id}>
                            <path className={getEdgeClasses(edge, selectedNodeId)} d={computeSelfLoopPath(sourceNode)} />
                            <path className={getEdgeClasses(edge, selectedNodeId)} d={computeSelfLoopArrow(sourceNode)} />
                          </g>
                        );
                      }
                      const from = getHandlePosition(sourceNode, edge.sourceHandle);
                      const to = getHandlePosition(targetNode, edge.targetHandle);
                      return (
                        <g key={edge.id}>
                          <path className={getEdgeClasses(edge, selectedNodeId)} style={edgeStrokeStyle(edge)} d={computeEdgePath(from, to)} />
                          <path className={getEdgeClasses(edge, selectedNodeId)} style={edgeStrokeStyle(edge)} d={computeArrowHead(to)} />
                          <ConditionLabel from={from} to={to} edge={edge} />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Cluster cards */}
                  {clusters.map((cluster) => {
                    const pos = clusterPositions[cluster.id];
                    if (!pos) return null;
                    const isExpanded = expandedClusters.has(cluster.id);
                    return (
                      <ClusterCard
                        key={cluster.id}
                        cluster={cluster}
                        position={pos}
                        isExpanded={isExpanded}
                        onToggle={() => toggleCluster(cluster.id)}
                      />
                    );
                  })}

                  {/* Nodes inside expanded clusters */}
                  {viewportNodes.map((node) => {
                    const clusterId = nodeClusterMap[node.id];
                    if (!clusterId || !expandedClusters.has(clusterId)) return null;
                    const dimByNeighbor = neighborIds ? !neighborIds.has(node.id) : false;
                    const dimByFilter = !matchesClassFilter(node);
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={node.id === selectedNodeId}
                        isDimmed={dimByNeighbor || dimByFilter}
                        onSelect={handleNodeSelect}
                        onOpenCode={handleNodeOpenCode}
                        onMove={handleNodeMove}
                        zoom={zoom}
                      />
                    );
                  })}
                </>
              ) : (
                <>
                  {/* === FLAT VIEW (original) === */}

                  {/* SVG edges */}
                  <svg className="absolute pointer-events-none" style={{ top: 0, left: 0, width: 5000, height: 5000, overflow: 'visible' }}>
                    {viewportEdges.map((edge) => {
                      const sourceNode = visibleNodeById.get(edge.source);
                      const targetNode = visibleNodeById.get(edge.target);
                      if (!sourceNode || !targetNode) return null;
                      if (edge.source === edge.target) {
                        return (
                          <g key={edge.id}>
                            <path className={getEdgeClasses(edge, selectedNodeId)} d={computeSelfLoopPath(sourceNode)} />
                            <path className={getEdgeClasses(edge, selectedNodeId)} d={computeSelfLoopArrow(sourceNode)} />
                          </g>
                        );
                      }
                      const from = getHandlePosition(sourceNode, edge.sourceHandle);
                      const to = getHandlePosition(targetNode, edge.targetHandle);
                      return (
                        <g key={edge.id}>
                          <path className={getEdgeClasses(edge, selectedNodeId)} style={edgeStrokeStyle(edge)} d={computeEdgePath(from, to)} />
                          <path className={getEdgeClasses(edge, selectedNodeId)} style={edgeStrokeStyle(edge)} d={computeArrowHead(to)} />
                          <ConditionLabel from={from} to={to} edge={edge} />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Nodes */}
                  {viewportNodes.map((node) => {
                    const dimByNeighbor = neighborIds ? !neighborIds.has(node.id) : false;
                    const dimByFilter = !matchesClassFilter(node);
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        isSelected={node.id === selectedNodeId}
                        isDimmed={dimByNeighbor || dimByFilter}
                        onSelect={handleNodeSelect}
                        onOpenCode={handleNodeOpenCode}
                        onMove={handleNodeMove}
                        zoom={zoom}
                      />
                    );
                  })}
                </>
              )}
            </div>

            {/* Minimap — stays fixed in viewport */}
            <Minimap
              nodes={visibleNodes}
              selectedNodeId={selectedNodeId}
              zoom={zoom}
              pan={pan}
              canvasSize={canvasSize}
              onNavigate={(newPan) => setPan(newPan)}
            />

            {/* Zoom controls */}
            <div className="absolute bottom-2 sm:bottom-4 right-2 sm:right-4 z-10 glass-panel rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-2">
              <button onClick={() => setZoom((z) => Math.max(0.15, z - 0.15))} className="text-gray-500 hover:text-gray-900 transition-colors px-0.5 sm:px-1">
                <span className="material-symbols-outlined text-[14px] sm:text-[16px]">remove</span>
              </button>
              <span className="font-label-sm text-gray-600 w-8 sm:w-10 text-center select-none text-[10px] sm:text-[12px]">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))} className="text-gray-500 hover:text-gray-900 transition-colors px-0.5 sm:px-1">
                <span className="material-symbols-outlined text-[14px] sm:text-[16px]">add</span>
              </button>
              <div className="w-px h-4 bg-gray-300 mx-0.5 sm:mx-1"></div>
              <button onClick={resetView} className="text-gray-500 hover:text-gray-900 transition-colors" title="Reset view">
                <span className="material-symbols-outlined text-[14px] sm:text-[16px]">fit_screen</span>
              </button>
            </div>
          </div>

          {/* Code Panel — always rendered, animated in/out */}
          <CodePanel
            node={selectedNode}
            open={ui.codePanelOpen && !!selectedNode}
            onClose={toggleCodePanel}
          />

          {/* Reopen button — top-right, visible when a node is selected but panel is closed */}
          {selectedNode && !ui.codePanelOpen && (
            <button
              onClick={toggleCodePanel}
              className="absolute top-2 sm:top-4 right-2 sm:right-4 z-10 glass-panel rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
              title="Show code panel"
            >
              <span className="material-symbols-outlined text-[16px]">code</span>
              <span className="font-label-sm">Code</span>
            </button>
          )}

          {/* File overlay — full-panel viewer for whole-file mode */}
          {selectedFile && (
            <FileOverlay
              file={selectedFile}
              nodes={nodes}
              sourceFiles={sourceFiles}
              onClose={closeFile}
              onJumpToFunction={handleFunctionSelect}
            />
          )}

          {/* Node Editor */}
          {ui.nodeEditorOpen && (
            <NodeEditorPanel
              existingNodes={nodes}
              onClose={closeNodeEditor}
              onSubmit={(formData) => {
                const maxY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.y)) : 0;
                const avgX = nodes.length > 0 ? nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length : 50;
                const newId = addNode({
                  functionName: formData.functionName,
                  filePath: formData.filePath,
                  complexity: '',
                  tags: [],
                  position: { x: Math.round(avgX), y: maxY + 150 },
                  icon: 'terminal',
                  code: formData.description
                    ? `// ${formData.description}\nexport function ${formData.functionName}() {\n  // TODO\n}`
                    : `export function ${formData.functionName}() {\n  // TODO\n}`,
                  startLine: 1,
                  highlightLine: null,
                  analysis: {
                    dependencies: '-',
                    returnType: 'unknown',
                    executionTime: '-',
                  },
                });
                if (formData.calledByNode) {
                  addEdge({
                    source: formData.calledByNode,
                    target: newId,
                    type: formData.calledByType,
                    sourceHandle: 'output',
                    targetHandle: 'input',
                  });
                }
                if (formData.callsNode) {
                  addEdge({
                    source: newId,
                    target: formData.callsNode,
                    type: formData.callsType,
                    sourceHandle: 'output',
                    targetHandle: 'input',
                  });
                }
                closeNodeEditor();
              }}
            />
          )}

          {/* Overview overlay */}
          {overviewOpen && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOverviewOpen(false)}>
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-primary">summarize</span>
                    <h3 className="font-label-md text-gray-900 text-base">Codebase Overview</h3>
                  </div>
                  <button onClick={() => setOverviewOpen(false)} className="p-1 text-gray-400 hover:text-gray-900 rounded hover:bg-gray-100">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                {overviewLoading && (
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                    <span className="text-sm">Generating overview…</span>
                  </div>
                )}
                {overviewError && (
                  <p className="text-sm text-rose-600">{overviewError}</p>
                )}
                {overview && (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{overview}</p>
                )}
              </div>
            </div>
          )}

          {/* Hotspots overlay */}
          {hotspotsData && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setHotspotsData(null)}>
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-orange-500">local_fire_department</span>
                    <h3 className="font-label-md text-gray-900 text-base">Hotspot Functions</h3>
                  </div>
                  <button onClick={() => setHotspotsData(null)} className="p-1 text-gray-400 hover:text-gray-900 rounded hover:bg-gray-100">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                {hotspotsData.length === 0 ? (
                  <p className="text-sm text-gray-500">No hotspots found.</p>
                ) : (
                  <div className="space-y-1">
                    {hotspotsData.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => { handleFunctionSelect(h.id); setHotspotsData(null); }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-100 text-left transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 truncate">{h.qualified_name || h.name}</p>
                          <p className="text-[11px] text-gray-400 truncate">{h.file}:{h.line}</p>
                        </div>
                        <span className="text-[11px] text-orange-600 shrink-0 ml-2">
                          {h.in_degree} callers
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dead code overlay */}
          {deadCodeData && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeadCodeData(null)}>
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-rose-500">delete_sweep</span>
                    <h3 className="font-label-md text-gray-900 text-base">Dead Code</h3>
                  </div>
                  <button onClick={() => setDeadCodeData(null)} className="p-1 text-gray-400 hover:text-gray-900 rounded hover:bg-gray-100">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                {deadCodeData.length === 0 ? (
                  <p className="text-sm text-gray-500">No dead code found.</p>
                ) : (
                  <div className="space-y-1">
                    {deadCodeData.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => { handleFunctionSelect(d.id); setDeadCodeData(null); }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-100 text-left transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 truncate">{d.qualified_name || d.name}</p>
                          <p className="text-[11px] text-gray-400 truncate">{d.file}:{d.line}</p>
                        </div>
                        <span className="text-[10px] text-rose-500 shrink-0 ml-2 bg-rose-50 px-1.5 py-0.5 rounded">
                          unreachable
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// --- Side Navigation ---

function SideNav({
  activePage,
  project,
  graphId,
  activeTab,
  onTabChange,
  nodes,
  selectedNodeId,
  selectedFile,
  onFileOpen,
  onFunctionSelect,
  onOverview,
  overviewLoading,
  onHotspots,
  hotspotsLoading,
  onDeadCode,
  deadCodeLoading,
  showUnusedNodes,
  onToggleUnused,
  unusedCount,
  classFilter,
  onToggleClassFilter,
  onClearClassFilter,
  visibleNodes,
}) {
  const tabs = [
    { id: 'explorer', icon: 'folder_open', label: 'Explorer' },
    { id: 'functions', icon: 'terminal', label: 'Functions', filled: true },
  ];

  const navLinks = [
    { to: '/workspace/call-graph', icon: 'hub', label: 'Call Graph', page: 'call-graph' },
    { to: '/workspace/control-flow', icon: 'fork_right', label: 'Control Flow', page: 'control-flow' },
  ];

  const panelOpen = activeTab === 'explorer' || activeTab === 'functions';
  const panelTitle = activeTab === 'functions' ? 'Functions' : 'Explorer';

  const railBtnBase =
    'w-full flex flex-col items-center py-1.5 sm:py-2 md:py-2.5 rounded transition-all duration-100 ease-in group';
  const railIcon =
    'material-symbols-outlined text-[18px] sm:text-[20px] md:text-[22px] md:mb-0.5 group-hover:scale-110 transition-transform';
  const railLabel = 'hidden';

  return (
    <div className="flex min-h-0 shrink-0 z-40">
      {/* Icon rail */}
      <nav className="w-12 sm:w-12 md:w-14 h-full flex flex-col items-center py-2 sm:py-3 md:py-3 bg-white border-r border-gray-200 shadow-[0_2px_4px_rgba(0,0,0,0.05)] overflow-y-auto">
        <div className="flex flex-col items-center w-full gap-1 px-0.5 sm:px-1 md:px-2 flex-1">
          {/* Page navigation */}
          {navLinks.map((nl) => (
            <Link
              key={nl.page}
              to={nl.to}
              className={`${railBtnBase} ${
                activePage === nl.page
                  ? 'text-deep-olive bg-soft-sage/30'
                  : 'text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive'
              }`}
              title={nl.label}
            >
              <span className={railIcon}>{nl.icon}</span>
              <span className={railLabel}>{nl.label}</span>
            </Link>
          ))}

          <div className="w-8 h-px bg-gray-200 my-1" />

          {/* Explorer / Functions tabs */}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`${railBtnBase} ${
                activeTab === tab.id
                  ? 'text-deep-olive bg-soft-sage/30'
                  : 'text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive'
              }`}
              title={tab.label}
            >
              <span
                className={railIcon}
                style={activeTab === tab.id && tab.filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {tab.icon}
              </span>
              <span className={railLabel}>{tab.label}</span>
            </button>
          ))}

          <div className="w-8 h-px bg-gray-200 my-1" />

          {/* AI / analysis actions */}
          <button
            onClick={onOverview}
            disabled={overviewLoading}
            className={`${railBtnBase} text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive disabled:opacity-50`}
            title="AI codebase overview"
          >
            <span className={`${railIcon} ${overviewLoading ? 'animate-spin' : ''}`}>
              {overviewLoading ? 'progress_activity' : 'summarize'}
            </span>
            <span className={railLabel}>Overview</span>
          </button>
          <button
            onClick={onHotspots}
            disabled={hotspotsLoading}
            className={`${railBtnBase} text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive disabled:opacity-50`}
            title="Find hotspot functions"
          >
            <span className={`${railIcon} ${hotspotsLoading ? 'animate-spin' : ''}`}>
              {hotspotsLoading ? 'progress_activity' : 'local_fire_department'}
            </span>
            <span className={railLabel}>Hotspots</span>
          </button>
          <button
            onClick={onDeadCode}
            disabled={deadCodeLoading}
            className={`${railBtnBase} text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive disabled:opacity-50`}
            title="Find dead code"
          >
            <span className={`${railIcon} ${deadCodeLoading ? 'animate-spin' : ''}`}>
              {deadCodeLoading ? 'progress_activity' : 'delete_sweep'}
            </span>
            <span className={railLabel}>Dead Code</span>
          </button>

          <div className="w-8 h-px bg-gray-200 my-1" />

          {/* Unused-node visibility toggle */}
          <button
            onClick={onToggleUnused}
            className={`${railBtnBase} relative ${
              showUnusedNodes
                ? 'text-rose-600 bg-rose-50'
                : 'text-gray-400 hover:bg-soft-sage/20 hover:text-deep-olive'
            }`}
            title={showUnusedNodes ? 'Hide unused nodes' : `Show unused nodes (${unusedCount} hidden)`}
          >
            <span className={railIcon}>{showUnusedNodes ? 'visibility' : 'visibility_off'}</span>
            <span className={railLabel}>Unused</span>
            {unusedCount > 0 && (
              <span className="absolute top-0.5 right-1 text-[9px] px-1 rounded-full bg-gray-200 text-gray-600 font-medium leading-tight">
                {unusedCount}
              </span>
            )}
          </button>

          {/* Classification chips: Unused / Entry / Leaf */}
          <div className="w-full flex flex-col items-stretch gap-1 mt-1 px-0.5">
            {CANVAS_FILTERS.map((f) => {
              const on = classFilter.has(f.id);
              const count = visibleNodes.reduce((s, n) => s + (f.match(n) ? 1 : 0), 0);
              return (
                <button
                  key={f.id}
                  onClick={() => onToggleClassFilter(f.id)}
                  title={`${f.label}: ${count} node${count === 1 ? '' : 's'}`}
                  className={`text-[10px] px-1.5 py-1 rounded flex items-center justify-center gap-1 border transition-colors ${
                    on
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white/70 text-gray-600 border-gray-200 hover:text-gray-900'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${f.dotClass}`} />
                  <span className="hidden">{f.label}</span>
                  <span className={`text-[9px] ${on ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
                </button>
              );
            })}
            {classFilter.size > 0 && (
              <button
                onClick={onClearClassFilter}
                className="text-[9px] py-0.5 rounded text-gray-400 hover:text-gray-900"
                title="Clear classification filter"
              >
                clear
              </button>
            )}
          </div>
        </div>

        <RepoFooter
          project={project}
          graphId={graphId}
          onReloaded={() => { if (graphId) useGraphStore.getState().loadGraph(graphId); }}
        />
      </nav>

      {/* Explorer / Functions panel — slides in/out */}
      <div
        className={`h-full overflow-hidden transition-[width] duration-200 ease-in-out border-r border-gray-200 ${
          panelOpen ? 'w-64 sm:w-72' : 'w-0 border-r-0'
        }`}
      >
        <div className="w-64 sm:w-72 h-full bg-gray-50 flex flex-col">
          <div className="h-10 px-3 flex items-center justify-between border-b border-gray-100 shrink-0">
            <span className="font-label-sm text-gray-500 uppercase tracking-wider text-[10px]">{panelTitle}</span>
          </div>
          <div className="flex-1 overflow-y-auto py-1 pr-2 min-h-0">
            {activeTab === 'functions' ? (
              <FunctionList nodes={nodes} selectedNodeId={selectedNodeId} onSelect={onFunctionSelect} />
            ) : (
              <FileTree
                nodes={nodes}
                selectedNodeId={selectedNodeId}
                selectedFile={selectedFile}
                onFileOpen={onFileOpen}
                onFunctionSelect={onFunctionSelect}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Functions Panel (grouped by file → container, with chip filters + search) ---

const FUNCTION_FILTERS = [
  { id: 'tests', label: 'tests', match: (n) => n.category === 'test' },
  { id: 'throws', label: 'throws', match: (n) => /\bthrows\b/.test(n.signature || '') },
  { id: 'private', label: 'private', match: (n) => /\bprivate\b/.test(n.signature || '') },
  { id: 'override', label: 'override', match: (n) => /\boverride\b/.test(n.signature || '') },
  { id: 'recursive', label: 'recursive', match: (n) => n.isSelfRecursive || n.isMutualRecursive },
  { id: 'entry', label: 'entry', match: (n) => (n.inDegree ?? 0) === 0 },
  { id: 'leaf', label: 'leaf', match: (n) => (n.outDegree ?? 0) === 0 },
];

function FunctionList({ nodes, selectedNodeId, onSelect }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => new Set());

  const toggleChip = (id) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filtered = nodes.filter((n) => {
    for (const f of FUNCTION_FILTERS) {
      if (active.has(f.id) && !f.match(n)) return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (n.qualifiedName || n.functionName).toLowerCase().includes(q) ||
      (n.signature || '').toLowerCase().includes(q) ||
      (n.filePath || '').toLowerCase().includes(q)
    );
  });

  // file -> container -> nodes[]
  const grouped = {};
  filtered.forEach((n) => {
    const file = n.filePath;
    const container = n.container || '(top-level)';
    if (!grouped[file]) grouped[file] = {};
    if (!grouped[file][container]) grouped[file][container] = [];
    grouped[file][container].push(n);
  });
  Object.values(grouped).forEach((containers) => {
    Object.values(containers).forEach((arr) => arr.sort((a, b) => a.startLine - b.startLine));
  });

  const fileEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col">
      {/* Search */}
      <div className="px-2 pt-1 pb-2 sticky top-0 bg-gray-50 z-10">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search functions…"
            className="w-full text-[12px] bg-white border border-gray-200 rounded pl-7 pr-7 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="mt-2 flex gap-1 flex-wrap">
          {FUNCTION_FILTERS.map((f) => {
            const on = active.has(f.id);
            return (
              <button
                key={f.id}
                onClick={() => toggleChip(f.id)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  on
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-primary/40 hover:text-gray-900'
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {(active.size > 0 || query) && (
            <button
              onClick={() => { setActive(new Set()); setQuery(''); }}
              className="text-[10px] px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-900"
            >
              clear
            </button>
          )}
        </div>

        <div className="mt-2 text-[10px] text-gray-400 font-label-sm uppercase tracking-wider">
          {filtered.length} of {nodes.length}
        </div>
      </div>

      {/* Tree */}
      <div className="text-[12px] font-inter select-none">
        {fileEntries.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-gray-400">No matches.</div>
        ) : (
          fileEntries.map(([file, containers]) => (
            <FunctionFileGroup
              key={file}
              file={file}
              containers={containers}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              defaultOpen
            />
          ))
        )}
      </div>
    </div>
  );
}

function FunctionFileGroup({ file, containers, selectedNodeId, onSelect, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const isTestFile = /(^|\/)Tests\//.test(file);
  const fileName = file.split('/').pop();
  const total = Object.values(containers).reduce((s, arr) => s + arr.length, 0);

  return (
    <div>
      <button
        className="relative w-full flex items-center gap-1.5 py-[5px] pl-2 pr-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="material-symbols-outlined text-[14px] shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
        <span className={`material-symbols-outlined text-[14px] shrink-0 ${isTestFile ? 'text-green-600' : 'text-deep-olive'}`}>
          {isTestFile ? 'science' : 'description'}
        </span>
        <span className="truncate flex-1 text-[12px]" title={file}>{fileName}</span>
        <span className="text-[9px] text-gray-400 font-label-sm">{total}</span>
      </button>
      {open && (
        <div>
          {Object.entries(containers).sort(([a], [b]) => a.localeCompare(b)).map(([container, arr]) => (
            <FunctionContainerGroup
              key={container}
              container={container}
              nodes={arr}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FunctionContainerGroup({ container, nodes, selectedNodeId, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        className="w-full flex items-center gap-1 py-[3px] pl-6 pr-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="material-symbols-outlined text-[12px] shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
        <span className="material-symbols-outlined text-[12px] shrink-0 text-amber-500">
          {container === '(top-level)' ? 'data_object' : 'category'}
        </span>
        <span className="truncate text-[11px] uppercase tracking-wider font-label-sm text-gray-500">{container}</span>
        <span className="ml-auto text-[9px] text-gray-400 font-label-sm">{nodes.length}</span>
      </button>
      {open && (
        <div>
          {nodes.map((n) => (
            <FunctionRow key={n.id} node={n} active={n.id === selectedNodeId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function FunctionRow({ node, active, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  const tagsToShow = [];
  if (node.isSelfRecursive) tagsToShow.push({ label: '↻', color: 'text-amber-600' });
  else if (node.isMutualRecursive) tagsToShow.push({ label: '⇄', color: 'text-amber-600' });
  if (/\bthrows\b/.test(node.signature || '')) tagsToShow.push({ label: 'th', color: 'text-rose-600' });
  if (/\boverride\b/.test(node.signature || '')) tagsToShow.push({ label: 'ov', color: 'text-violet-600' });
  if (/\bprivate\b/.test(node.signature || '')) tagsToShow.push({ label: 'pr', color: 'text-gray-500' });

  return (
    <button
      ref={ref}
      onClick={() => onSelect(node.id)}
      className={`w-full flex items-center gap-1.5 py-[4px] pl-12 pr-2 text-left transition-colors group ${
        active ? 'bg-soft-sage/30 text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <span className={`material-symbols-outlined text-[12px] shrink-0 ${active ? 'text-primary' : 'text-gray-400'}`}>
        {node.icon || 'function'}
      </span>
      <span className="truncate flex-1 text-[12px] code-font" title={node.signature || node.qualifiedName}>
        {node.functionName}
      </span>
      <span className="flex items-center gap-0.5 shrink-0">
        {tagsToShow.map((t, i) => (
          <span key={i} className={`text-[8px] font-label-sm ${t.color}`}>{t.label}</span>
        ))}
      </span>
      <span className="text-[9px] font-label-sm text-gray-400 shrink-0 ml-1" title={`${node.inDegree ?? 0} callers · ${node.outDegree ?? 0} callees`}>
        {node.inDegree ?? 0}·{node.outDegree ?? 0}
      </span>
    </button>
  );
}

// --- Cluster / Package Card ---

const CLUSTER_COLORS = [
  { bg: 'bg-indigo-50', border: 'border-indigo-200', accent: 'text-indigo-600', headerBg: 'bg-indigo-100', ring: 'ring-indigo-300' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'text-emerald-600', headerBg: 'bg-emerald-100', ring: 'ring-emerald-300' },
  { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'text-amber-600', headerBg: 'bg-amber-100', ring: 'ring-amber-300' },
  { bg: 'bg-rose-50', border: 'border-rose-200', accent: 'text-rose-600', headerBg: 'bg-rose-100', ring: 'ring-rose-300' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', accent: 'text-cyan-600', headerBg: 'bg-cyan-100', ring: 'ring-cyan-300' },
  { bg: 'bg-violet-50', border: 'border-violet-200', accent: 'text-violet-600', headerBg: 'bg-violet-100', ring: 'ring-violet-300' },
  { bg: 'bg-orange-50', border: 'border-orange-200', accent: 'text-orange-600', headerBg: 'bg-orange-100', ring: 'ring-orange-300' },
  { bg: 'bg-teal-50', border: 'border-teal-200', accent: 'text-teal-600', headerBg: 'bg-teal-100', ring: 'ring-teal-300' },
];

function clusterColorIndex(clusterId) {
  let hash = 0;
  for (let i = 0; i < clusterId.length; i++) hash = ((hash << 5) - hash + clusterId.charCodeAt(i)) | 0;
  return Math.abs(hash) % CLUSTER_COLORS.length;
}

function ClusterCard({ cluster, position, isExpanded, onToggle }) {
  const colors = CLUSTER_COLORS[clusterColorIndex(cluster.id)];
  const testCount = cluster.category_breakdown?.test || 0;
  const sourceCount = cluster.category_breakdown?.source || 0;

  return (
    <div
      className="absolute z-[5]"
      style={{
        top: position.y,
        left: position.x,
        width: position.width,
        height: position.height,
      }}
    >
      <div
        className={`
          h-full rounded-xl border-2 ${colors.border} ${colors.bg}
          ${isExpanded ? 'ring-2 ' + colors.ring : ''}
          transition-all duration-300 overflow-hidden
          ${isExpanded ? '' : 'cursor-pointer hover:shadow-lg hover:scale-[1.02]'}
        `}
        style={{ transition: 'box-shadow 0.2s, transform 0.2s' }}
      >
        {/* Header bar */}
        <div
          className={`${colors.headerBg} px-4 py-3 flex items-center gap-2.5 cursor-pointer select-none`}
          onClick={onToggle}
        >
          <span className={`material-symbols-outlined text-[20px] ${colors.accent}`}>
            {isExpanded ? 'folder_open' : 'folder'}
          </span>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-[14px] ${colors.accent} truncate`}>
              {cluster.ai_label || cluster.label}
            </div>
            {cluster.directory && (
              <div className="text-[10px] text-gray-400 truncate">
                {cluster.directory}
              </div>
            )}
          </div>
          <span className={`material-symbols-outlined text-[18px] ${colors.accent} transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </div>

        {/* Collapsed body: stats */}
        {!isExpanded && (
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-gray-400">function</span>
                <span className="text-[12px] text-gray-600 font-medium">{cluster.node_count}</span>
                <span className="text-[10px] text-gray-400">functions</span>
              </div>
              {cluster.internal_edge_count > 0 && (
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-gray-400">call_split</span>
                  <span className="text-[12px] text-gray-600 font-medium">{cluster.internal_edge_count}</span>
                  <span className="text-[10px] text-gray-400">calls</span>
                </div>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {sourceCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-white/70 text-[10px] text-gray-500 border border-gray-200">
                  {sourceCount} source
                </span>
              )}
              {testCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-green-50 text-[10px] text-green-600 border border-green-200">
                  {testCount} test
                </span>
              )}
              {cluster.container && (
                <span className={`px-2 py-0.5 rounded-full bg-white/70 text-[10px] ${colors.accent} border ${colors.border}`}>
                  {cluster.container}
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">touch_app</span>
              Click to expand
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Draggable Node Card ---

const NodeCard = memo(function NodeCard({ node, isSelected, isDimmed = false, onSelect, onOpenCode, onMove, zoom = 1 }) {
  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(node.id);
      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = { ...node.position };

      const onMouseMove = (ev) => {
        onMove(node.id, {
          x: startPos.x + (ev.clientX - startX) / zoom,
          y: startPos.y + (ev.clientY - startY) / zoom,
        });
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [node.id, node.position, onSelect, onMove, zoom],
  );

  const iconColor =
    isSelected ? 'text-primary' : node.icon === 'warning' ? 'text-error' : 'text-gray-500';

  const isTest = node.category === 'test';
  const isUnused = isUnusedNode(node);
  const isLeaf = isLeafNode(node);
  const cardBorder = isTest ? { borderTopColor: '#16a34a' } : undefined;
  const fileLabel = node.filePath.split('/').pop();

  return (
    <div
      className="absolute z-10"
      style={{
        top: node.position.y,
        left: node.position.x,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
    >
      <div
        className={`node-card ${isSelected ? 'active' : ''} ${isDimmed ? 'dimmed' : ''} ${isUnused ? 'is-dead' : ''} ${isLeaf ? 'is-leaf' : ''} rounded px-3 py-3 cursor-move h-full overflow-hidden`}
        style={cardBorder}
        onMouseDown={handleMouseDown}
        onDoubleClick={(e) => { e.stopPropagation(); onOpenCode && onOpenCode(node.id); }}
      >
        <div className="flex justify-between items-center mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`material-symbols-outlined text-[16px] ${iconColor}`}>{node.icon}</span>
            <span className="font-label-sm text-gray-600 truncate text-[11px]" title={node.filePath}>
              {fileLabel}:{node.startLine}
            </span>
          </div>
          {isSelected && (
            <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(79,70,229,0.4)] shrink-0" />
          )}
        </div>
        <div className="font-body-md text-gray-900 truncate text-[16px]" title={node.qualifiedName || node.functionName}>
          {node.container ? (
            <>
              <span className="text-gray-400">{node.container}.</span>
              <span>{node.functionName}</span>
            </>
          ) : (
            node.functionName
          )}
          <span className="text-gray-400">()</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {isTest && (
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-[9px] font-label-sm text-green-700 border border-green-200">
              TEST
            </span>
          )}
          {isUnused && (
            <span
              className="px-1.5 py-0.5 rounded bg-rose-50 text-[9px] font-label-sm text-rose-700 border border-rose-200"
              title="Isolated — zero callers and zero callees"
            >
              UNUSED
            </span>
          )}
          {node.isSelfRecursive && (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-[9px] font-label-sm text-amber-700 border border-amber-200" title="Self-recursive">
              ↻ rec
            </span>
          )}
          {node.isMutualRecursive && !node.isSelfRecursive && (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-[9px] font-label-sm text-amber-700 border border-amber-200" title="Mutual recursion">
              ⇄ rec
            </span>
          )}
          {node.tags && node.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-gray-100 text-[9px] font-label-sm text-gray-500">
              {tag}
            </span>
          ))}
          <span className="ml-auto text-[9px] font-label-sm text-gray-400 flex items-center gap-0.5" title={`${node.inDegree ?? 0} callers · ${node.outDegree ?? 0} callees`}>
            <span>←{node.inDegree ?? 0}</span>
            <span>→{node.outDegree ?? 0}</span>
          </span>
        </div>
      </div>

    </div>
  );
});

// --- AI text highlighter: function names, qualified methods, `code` spans ---
const HIGHLIGHT_RE = /(`[^`]+`)|([A-Za-z_]\w+(?:\.[A-Za-z_]\w*)+)|([a-zA-Z_]\w*\(\))/g;
function highlightTokens(text) {
  if (text == null || text === '') return text;
  const out = [];
  let last = 0;
  let key = 0;
  let m;
  HIGHLIGHT_RE.lastIndex = 0;
  while ((m = HIGHLIGHT_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let token = m[0];
    if (token.startsWith('`') && token.endsWith('`')) token = token.slice(1, -1);
    out.push(
      <span key={key++} className="font-semibold text-primary">{token}</span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// --- Code Panel ---

function CodePanel({ node, open, onClose }) {
  const [width, setWidth] = useState(384); // w-96 = 384px
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [displayedSummary, setDisplayedSummary] = useState('');
  const [summaryRevealed, setSummaryRevealed] = useState(false);
  // Impact analysis state
  const [impact, setImpact] = useState(null);
  const [impactNarrative, setImpactNarrative] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState(null);
  const [displayedImpact, setDisplayedImpact] = useState('');
  const [impactRevealed, setImpactRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const MIN_W = 280;
  const MAX_W = 700;

  // Reset summary & impact when the selected node changes
  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(false);
    setImpact(null);
    setImpactNarrative(null);
    setImpactError(null);
    setImpactLoading(false);
    setCopied(false);
  }, [node?.id]);

  // Typewriter + smooth height-reveal for AI summary
  useEffect(() => {
    if (!summary) {
      setDisplayedSummary('');
      setSummaryRevealed(false);
      return;
    }
    setDisplayedSummary('');
    setSummaryRevealed(false);
    // Two RAFs: commit the collapsed state, then flip to revealed so the
    // grid-rows transition fires from 0fr → 1fr.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSummaryRevealed(true));
    });
    // Begin typing slightly after the height-reveal starts.
    let i = 0;
    const typingDelay = setTimeout(() => {
      const id = setInterval(() => {
        i = Math.min(i + 2, summary.length);
        setDisplayedSummary(summary.slice(0, i));
        if (i >= summary.length) clearInterval(id);
      }, 15);
      typingDelay.intervalId = id;
    }, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(typingDelay);
      if (typingDelay.intervalId) clearInterval(typingDelay.intervalId);
    };
  }, [summary]);

  // Typewriter + smooth height-reveal for impact narrative
  useEffect(() => {
    if (!impactNarrative) {
      setDisplayedImpact('');
      setImpactRevealed(false);
      return;
    }
    setDisplayedImpact('');
    setImpactRevealed(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setImpactRevealed(true));
    });
    let i = 0;
    const typingDelay = setTimeout(() => {
      const id = setInterval(() => {
        i = Math.min(i + 2, impactNarrative.length);
        setDisplayedImpact(impactNarrative.slice(0, i));
        if (i >= impactNarrative.length) clearInterval(id);
      }, 15);
      typingDelay.intervalId = id;
    }, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(typingDelay);
      if (typingDelay.intervalId) clearInterval(typingDelay.intervalId);
    };
  }, [impactNarrative]);

  const handleSummarize = useCallback(async () => {
    if (!node?.id) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch(`${API_BASE}${ENDPOINTS.llmExplain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: node.id }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Request failed: ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }
      const data = await res.json();
      setSummary(data.explanation || '(empty response)');
    } catch (err) {
      setSummaryError(err.message || 'Failed to summarize');
    } finally {
      setSummaryLoading(false);
    }
  }, [node?.id]);

  const handleImpactAnalysis = useCallback(async () => {
    if (!node?.id) return;
    setImpactLoading(true);
    setImpactError(null);
    setImpact(null);
    setImpactNarrative(null);
    try {
      // Step 1: get predicted impact
      const impactRes = await fetch(`${API_BASE}${ENDPOINTS.predictImpact}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: node.id }),
      });
      if (!impactRes.ok) {
        const errBody = await impactRes.text().catch(() => '');
        throw new Error(`Impact request failed: ${impactRes.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }
      const impactData = await impactRes.json();
      setImpact(impactData);

      // Step 2: get LLM narrative for the impact
      const narrativeRes = await fetch(`${API_BASE}${ENDPOINTS.llmImpactNarrative}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: node.id }),
      });
      if (!narrativeRes.ok) {
        const errBody = await narrativeRes.text().catch(() => '');
        throw new Error(`Narrative request failed: ${narrativeRes.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }
      const narrativeData = await narrativeRes.json();
      setImpactNarrative(narrativeData.narrative || '(empty response)');
    } catch (err) {
      setImpactError(err.message || 'Failed to analyze impact');
    } finally {
      setImpactLoading(false);
    }
  }, [node?.id]);

  const handleCopy = useCallback(() => {
    if (!node?.code) return;
    navigator.clipboard.writeText(node.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [node?.code]);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setWidth(Math.max(MIN_W, Math.min(MAX_W, startW + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <aside
      className={`border-l border-gray-200 bg-white flex flex-col h-full z-20 flex-shrink-0 relative overflow-hidden ${
        dragging ? '' : 'transition-[width,min-width] duration-200 ease-in-out'
      }`}
      style={{ width: open ? width : 0, minWidth: open ? MIN_W : 0 }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 w-1.5 h-full cursor-col-resize z-30 hover:bg-primary/30 active:bg-primary/40 transition-colors"
        onMouseDown={handleResizeStart}
      />
      <div className="h-12 border-b border-gray-200 flex items-center justify-between px-4 shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[18px] text-primary">code</span>
          <span className="font-label-md text-gray-700 truncate">
            {node ? node.filePath : 'No selection'}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100 transition-colors">
            <span className="material-symbols-outlined text-[16px]">more_vert</span>
          </button>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100 transition-colors">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* Scrollable body: Node Analysis + Code view */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      {/* Node Analysis — top */}
      <div className="border-b border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center">
          <span className="font-label-sm text-gray-500 uppercase tracking-wider text-[10px]">Node Analysis</span>
          <div className="flex gap-1.5">
            <button
              onClick={handleSummarize}
              disabled={!node || summaryLoading}
              className="flex items-center gap-1.5 text-[12px] font-label-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-[14px] ${summaryLoading ? 'animate-spin' : ''}`}>
                {summaryLoading ? 'progress_activity' : 'auto_awesome'}
              </span>
              {summaryLoading ? 'Summarizing…' : 'Summarize'}
            </button>
            <button
              onClick={handleImpactAnalysis}
              disabled={!node || impactLoading}
              className="flex items-center gap-1.5 text-[12px] font-label-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-[14px] ${impactLoading ? 'animate-spin' : ''}`}>
                {impactLoading ? 'progress_activity' : 'bolt'}
              </span>
              {impactLoading ? 'Analyzing…' : 'Impact'}
            </button>
          </div>
        </div>
        <div className="p-4">
          {node && node.analysis ? (
            <>
              {summaryError && (
                <p className="font-body-md text-sm text-rose-600 mb-3">{summaryError}</p>
              )}
              {summary && (
                <div className="mb-6">
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="material-symbols-outlined text-[12px] text-primary">auto_awesome</span>
                    <span className="font-label-sm text-[10px] text-primary uppercase tracking-wider">AI Summary</span>
                  </div>
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-500 ease-out"
                    style={{ gridTemplateRows: summaryRevealed ? '1fr' : '0fr', opacity: summaryRevealed ? 1 : 0 }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div
                        className="relative text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap"
                        style={{ fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, serif", fontWeight: 400, letterSpacing: '0.005em' }}
                      >
                        {/* Invisible full text reserves final height up-front */}
                        <p aria-hidden className="invisible m-0">{highlightTokens(summary)}</p>
                        {/* Visible typed portion overlays at the same position */}
                        <p className="absolute inset-0 m-0">
                          {highlightTokens(displayedSummary)}
                          {displayedSummary.length < summary.length && (
                            <span className="inline-block w-[1px] h-[1em] bg-gray-700 ml-0.5 align-text-bottom animate-pulse" />
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {impactError && (
                <p className="font-body-md text-sm text-rose-600 mb-3">{impactError}</p>
              )}
              {(impact || impactNarrative) && (
                <div className="mb-6 px-3 py-2 rounded bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="material-symbols-outlined text-[12px] text-amber-600">bolt</span>
                    <span className="font-label-sm text-[10px] text-amber-700 uppercase tracking-wider">Impact Analysis</span>
                  </div>
                  {impactNarrative && (
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-500 ease-out mb-2"
                      style={{ gridTemplateRows: impactRevealed ? '1fr' : '0fr', opacity: impactRevealed ? 1 : 0 }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div
                          className="relative text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap"
                          style={{ fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, serif", fontWeight: 400, letterSpacing: '0.005em' }}
                        >
                          <p aria-hidden className="invisible m-0">{highlightTokens(impactNarrative)}</p>
                          <p className="absolute inset-0 m-0">
                            {highlightTokens(displayedImpact)}
                            {displayedImpact.length < impactNarrative.length && (
                              <span className="inline-block w-[1px] h-[1em] bg-gray-700 ml-0.5 align-text-bottom animate-pulse" />
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {impact && impact.affected && impact.affected.length > 0 && (!impactNarrative || displayedImpact.length === impactNarrative.length) && (
                    <div className="mt-1.5 animate-[fadeIn_300ms_ease-out]">
                      <span className="font-label-sm text-[10px] text-amber-700 uppercase tracking-wider">
                        Affected nodes ({impact.affected.length})
                      </span>
                      <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                        {impact.affected.slice(0, 15).map((a, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] text-gray-600 px-1 py-0.5 rounded hover:bg-amber-100/50">
                            <span className="truncate flex-1">{a.id.split(':').pop() || a.id}</span>
                            <span className="text-[10px] text-amber-600 ml-2 shrink-0">
                              risk {(a.risk_score * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {impact && impact.affected && impact.affected.length === 0 && (!impactNarrative || displayedImpact.length === impactNarrative.length) && (
                    <p className="text-[11px] text-gray-500 animate-[fadeIn_300ms_ease-out]">No downstream nodes affected.</p>
                  )}
                </div>
              )}
              {node.signature && (
                <div className="mb-3 px-2 py-1.5 rounded bg-gray-50 border border-gray-200 code-font text-[11px] text-gray-700 break-all">
                  {node.signature}
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-400 text-sm">No node selected.</p>
          )}
        </div>
      </div>

      {/* Code view — middle */}
      <div className="p-4 bg-white relative border-b border-gray-200">
        {node ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-100/60 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-[14px] text-gray-400 shrink-0">description</span>
                <span className="font-label-sm text-[10px] text-gray-500 uppercase tracking-wider truncate">{node.filePath}</span>
              </div>
              <button
                onClick={handleCopy}
                disabled={!node.code}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900 px-1.5 py-0.5 rounded hover:bg-gray-200/60 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title={copied ? 'Copied!' : 'Copy code'}
              >
                <span className="material-symbols-outlined text-[12px]">{copied ? 'check' : 'content_copy'}</span>
                <span className="font-label-sm uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              <CodeView code={node.code || ''} startLine={node.startLine || 1} highlightLine={node.highlightLine} />
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm font-label-sm">Click a node to view its source code.</p>
        )}
      </div>

      {/* Stats — bottom */}
      {node && node.analysis && (
        <div className="p-4 bg-white">
          <div className="space-y-2">
            {node.container && <AnalysisRow label="Container" value={node.container} />}
            <AnalysisRow label="Return Type" value={node.returnType || node.analysis.returnType || 'Void'} />
            {node.lineEnd != null && (
              <AnalysisRow label="Lines" value={`${node.startLine}–${node.lineEnd}`} />
            )}
            <AnalysisRow
              label="Callers / Callees"
              value={`${node.inDegree ?? 0} ← · → ${node.outDegree ?? 0}`}
              highlight={(node.inDegree ?? 0) === 0 || (node.outDegree ?? 0) === 0}
            />
            {node.category && (
              <AnalysisRow label="Category" value={node.category} />
            )}
            {(node.isSelfRecursive || node.isMutualRecursive) && (
              <AnalysisRow
                label="Recursion"
                value={node.isSelfRecursive ? 'self-recursive' : 'mutual'}
                highlight
              />
            )}
            {node.params && node.params.length > 0 && <ParamsList params={node.params} />}
            {node.analysis.dependencies && node.analysis.dependencies !== '-' && (
              <DependenciesList value={node.analysis.dependencies} />
            )}
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}

// --- Full-panel File Overlay (whole file view that covers the workspace) ---

function FileOverlay({ file, nodes, sourceFiles: dynamicSources, onClose, onJumpToFunction }) {
  const source = (dynamicSources && dynamicSources[file]) || '';
  const fnNodes = nodes.filter((n) => n.filePath === file).sort((a, b) => a.startLine - b.startLine);
  const totalLines = source ? source.split('\n').length : 0;
  const tests = fnNodes.filter((n) => n.category === 'test').length;
  const sources = fnNodes.length - tests;
  const codeRef = useRef(null);

  const jumpToLine = (line) => {
    if (!codeRef.current) return;
    const target = codeRef.current.querySelector(`[data-line="${line}"]`);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const goToFunction = (id) => {
    onClose();
    if (onJumpToFunction) onJumpToFunction(id);
  };

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col animate-[fadeIn_120ms_ease-out]">
      {/* Tab bar — single tab spanning the panel */}
      <div className="h-10 bg-gray-50 border-b border-gray-200 flex items-stretch shrink-0">
        <div className="flex items-center gap-2 pl-3 pr-2 border-r border-gray-200 bg-white border-t-2 border-t-primary -mt-px max-w-[320px]">
          <span className="material-symbols-outlined text-[15px] text-primary shrink-0">description</span>
          <span className="text-[12px] code-font truncate" title={file}>{file}</span>
          <button
            onClick={onClose}
            className="ml-1 p-0.5 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-100"
            title="Close file (Esc)"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-end pr-3 text-[10px] text-gray-400 font-label-sm uppercase tracking-wider">
          {totalLines} lines · {fnNodes.length} function{fnNodes.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Directions banner */}
      <div className="px-4 py-2 bg-soft-sage/20 border-b border-soft-sage/40 flex items-start gap-2 shrink-0">
        <span className="material-symbols-outlined text-[15px] text-deep-olive mt-0.5 shrink-0">tips_and_updates</span>
        <div className="text-[12px] text-deep-olive leading-snug">
          <strong>File view.</strong>{' '}
          Click a function chip to jump back to the canvas, or any{' '}
          <span className="code-font">L42</span> to scroll its definition into view.{' '}
          <span className="text-deep-olive/70">▸</span> markers in the gutter mark where each function starts.{' '}
          Press <span className="code-font px-1 rounded bg-soft-sage/30">Esc</span> or the{' '}
          <span className="code-font">×</span> above to return to the graph.
        </div>
      </div>

      {/* Body — two columns: outline on the left, source on the right */}
      <div className="flex-1 flex min-h-0">
        {/* Outline */}
        <aside className="w-72 border-r border-gray-200 bg-gray-50 flex flex-col shrink-0">
          <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <span className="font-label-sm text-gray-500 uppercase tracking-wider text-[10px]">Outline</span>
            <div className="flex gap-1">
              {sources > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[9px] font-label-sm text-gray-600 border border-gray-200">
                  {sources} src
                </span>
              )}
              {tests > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-green-50 text-[9px] font-label-sm text-green-700 border border-green-200">
                  {tests} test
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {fnNodes.length === 0 ? (
              <p className="text-[11px] text-gray-400 px-2 py-2">No parsed functions in this file.</p>
            ) : (
              <ul className="space-y-0.5">
                {fnNodes.map((fn) => (
                  <li key={fn.id} className="group">
                    <div className="flex items-center gap-1 text-xs">
                      <button
                        onClick={() => jumpToLine(fn.startLine)}
                        className="text-gray-400 text-[10px] code-font hover:text-primary w-9 shrink-0 text-right"
                        title="Scroll source to this line"
                      >
                        L{fn.startLine}
                      </button>
                      <button
                        onClick={() => goToFunction(fn.id)}
                        className="flex-1 flex items-center gap-1.5 text-left px-2 py-1 rounded hover:bg-white text-gray-700 hover:text-primary transition-colors min-w-0"
                        title={fn.signature}
                      >
                        <span className="material-symbols-outlined text-[12px] text-gray-400 group-hover:text-primary shrink-0">
                          {fn.icon || 'function'}
                        </span>
                        <span className="truncate code-font text-[11px]">
                          {fn.container && <span className="text-gray-400">{fn.container}.</span>}
                          {fn.functionName}
                        </span>
                        {fn.category === 'test' && (
                          <span className="text-[8px] font-label-sm text-green-700 shrink-0">TEST</span>
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Source */}
        <div className="flex-1 overflow-y-auto p-4 bg-white" ref={codeRef}>
          {source ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-100/60 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-gray-400">description</span>
                <span className="font-label-sm text-[10px] text-gray-500 uppercase tracking-wider">{file}</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <CodeView code={source} startLine={1} highlightLine={null} markerLines={fnNodes.map((n) => n.startLine)} />
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm font-label-sm">No source available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Syntax highlight tokens (VS Code light theme colors)
const SYN = {
  keyword: '#8b5cf6',   // purple
  string: '#16a34a',    // green
  comment: '#9ca3af',   // gray
  number: '#ea580c',    // orange
  constant: '#2563eb',  // blue
  fn: '#2563eb',        // blue
  type: '#0d9488',      // teal
  punct: '#64748b',     // slate
  plain: '#1e293b',     // dark
};

const KEYWORDS = new Set([
  'function','const','let','var','return','if','else','for','while','do',
  'switch','case','break','continue','class','extends','new','this','typeof',
  'instanceof','in','of','import','from','export','default','async','await',
  'try','catch','finally','throw','yield','delete','void','static','get','set',
  'super','with','debugger','enum','implements','interface','package','private',
  'protected','public','abstract','boolean','byte','char','double','final',
  'float','goto','int','long','native','short','synchronized','throws',
  'transient','volatile','def','self','elif','except','pass','raise','lambda',
  'None','print','range','True','False',
]);

const CONSTANTS = new Set(['true','false','null','undefined','NaN','Infinity','None','True','False']);
const TYPES = new Set(['string','number','boolean','object','any','void','never','Promise','Array','Map','Set','Date','Error','Response','Request']);

function highlightLine(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    // Comments
    if (text[i] === '/' && text[i + 1] === '/') {
      tokens.push({ text: text.slice(i), color: SYN.comment });
      break;
    }
    if (text[i] === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      tokens.push({ text: text.slice(i), color: SYN.comment });
      break;
    }
    // Strings
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const q = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== q) { if (text[j] === '\\') j++; j++; }
      j = Math.min(j + 1, text.length);
      tokens.push({ text: text.slice(i, j), color: SYN.string });
      i = j;
      continue;
    }
    // Numbers
    if (/[0-9]/.test(text[i]) && (i === 0 || /[\s(,=+\-*/<>[\]{}:;!&|^~%]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && /[0-9.xXa-fA-F_eEn]/.test(text[j])) j++;
      tokens.push({ text: text.slice(i, j), color: SYN.number });
      i = j;
      continue;
    }
    // Words
    if (/[a-zA-Z_$@]/.test(text[i])) {
      let j = i;
      while (j < text.length && /[a-zA-Z0-9_$@]/.test(text[j])) j++;
      const word = text.slice(i, j);
      let color = SYN.plain;
      if (KEYWORDS.has(word)) color = SYN.keyword;
      else if (CONSTANTS.has(word)) color = SYN.constant;
      else if (TYPES.has(word)) color = SYN.type;
      else if (j < text.length && text[j] === '(') color = SYN.fn;
      else if (text[i] === '@') color = SYN.keyword;
      tokens.push({ text: word, color });
      i = j;
      continue;
    }
    // Punctuation / operators
    if (/[{}()[\];:.,=+\-*/<>!&|^~%?]/.test(text[i])) {
      let j = i;
      while (j < text.length && /[=+\-*/<>!&|^~%?]/.test(text[j])) j++;
      if (j === i) j = i + 1;
      tokens.push({ text: text.slice(i, j), color: SYN.punct });
      i = j;
      continue;
    }
    // Whitespace / other
    let j = i;
    while (j < text.length && !/[a-zA-Z0-9_$@"'`/#{}\[\]();:.,=+\-*/<>!&|^~%?]/.test(text[j])) j++;
    if (j === i) j = i + 1;
    tokens.push({ text: text.slice(i, j), color: SYN.plain });
    i = j;
  }
  return tokens;
}

function CodeView({ code, startLine, highlightLine: hlLine, markerLines }) {
  const lines = code.split('\n');
  const start = startLine || 1;
  const markers = new Set(markerLines || []);

  return (
    <div className="flex font-label-sm text-[12px] code-font leading-relaxed">
      <div className="flex flex-col text-gray-400 pr-4 select-none text-right border-r border-gray-200 mr-4 shrink-0">
        {lines.map((_, i) => {
          const ln = start + i;
          const isHl = ln === hlLine;
          const isMarker = markers.has(ln);
          return (
            <span key={i} className={isHl ? 'text-primary font-semibold' : isMarker ? 'text-deep-olive' : ''}>
              {isMarker && !isHl ? <span className="text-deep-olive/70 mr-0.5">▸</span> : null}
              {ln}
            </span>
          );
        })}
      </div>
      <pre className="flex-1 whitespace-pre overflow-x-auto">
        {lines.map((line, i) => {
          const ln = start + i;
          const isHl = ln === hlLine;
          const isMarker = markers.has(ln);
          let cls = '';
          if (isHl) cls = 'bg-primary/10 -ml-4 pl-4 border-l-2 border-primary';
          else if (isMarker) cls = 'bg-soft-sage/15 -ml-4 pl-4 border-l-2 border-soft-sage';
          return (
            <div key={i} data-line={ln} className={cls}>
              {line
                ? highlightLine(line).map((tok, ti) => (
                    <span key={ti} style={{ color: tok.color }}>{tok.text}</span>
                  ))
                : ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ParamsList({ params }) {
  return (
    <div>
      <span className="font-label-sm text-gray-500 text-xs">Parameters</span>
      <ul className="mt-1 space-y-0.5">
        {params.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs text-gray-700 font-label-sm code-font">
            <span className="w-1 h-1 rounded-full bg-gray-400 shrink-0"></span>
            {p.label && p.label !== p.name && <span className="text-gray-400">{p.label} </span>}
            <span>{p.name}</span>
            {p.type && <span className="text-teal-600">: {p.type}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DependenciesList({ value }) {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <div>
      <span className="font-label-sm text-gray-500 text-xs">Dependencies</span>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-1.5 text-xs text-gray-700 font-label-sm">
            <span className="w-1 h-1 rounded-full bg-gray-400 shrink-0"></span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisRow({ label, value, highlight }) {
  return (
    <div className="flex justify-between items-center">
      <span className="font-label-sm text-gray-500 text-xs">{label}</span>
      <span className={`font-label-sm text-xs bg-gray-100 px-2 py-0.5 rounded ${highlight ? 'text-primary' : 'text-gray-700'}`}>
        {value}
      </span>
    </div>
  );
}

// --- Node Editor Form ---

function NodeEditorPanel({ existingNodes, onClose, onSubmit }) {
  const [form, setForm] = useState({
    functionName: '',
    filePath: '',
    description: '',
    calledByNode: '',
    calledByType: 'normal',
    callsNode: '',
    callsType: 'normal',
  });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = () => {
    if (!form.functionName.trim()) return;
    onSubmit(form);
    setForm({
      functionName: '',
      filePath: '',
      description: '',
      calledByNode: '',
      calledByType: 'normal',
      callsNode: '',
      callsType: 'normal',
    });
  };

  return (
    <div className="absolute left-2 sm:left-6 top-12 sm:top-6 w-[calc(100%-16px)] sm:w-80 bg-white rounded-lg shadow-[0_12px_24px_rgba(0,0,0,0.08)] z-30 flex flex-col border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <span className="font-label-md text-gray-900 font-medium flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">add_box</span>
          New Function Node
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div className="p-4 flex flex-col gap-4 bg-white max-h-[calc(100vh-200px)] overflow-y-auto">
        <div className="flex flex-col gap-1">
          <label className="font-label-sm text-[10px] text-gray-400 uppercase tracking-wider">Function Name</label>
          <input
            className="bg-white border-b border-gray-200 border-t-0 border-x-0 focus:border-primary focus:ring-0 text-gray-900 font-label-md px-0 py-1 text-sm transition-colors w-full placeholder:text-gray-400"
            placeholder="e.g. hashPassword"
            type="text"
            value={form.functionName}
            onChange={(e) => update('functionName', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-label-sm text-[10px] text-gray-400 uppercase tracking-wider">File Path</label>
          <input
            className="bg-white border-b border-gray-200 border-t-0 border-x-0 focus:border-primary focus:ring-0 text-gray-900 font-label-md px-0 py-1 text-sm transition-colors w-full placeholder:text-gray-400"
            placeholder="src/utils/crypto.ts"
            type="text"
            value={form.filePath}
            onChange={(e) => update('filePath', e.target.value)}
          />
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded p-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <label className="font-label-sm text-[10px] text-primary uppercase tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">auto_awesome</span> Smart Add
            </label>
          </div>
          <textarea
            className="w-full bg-transparent border-0 focus:ring-0 text-sm text-gray-700 placeholder:text-gray-400 resize-none h-16 p-0 font-body-md"
            placeholder="Describe what this function should do..."
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </div>
        <div className="h-px w-full bg-gray-100 my-2"></div>
        <span className="font-label-sm text-xs text-gray-900 mb-1">Relationships</span>
        {/* Called By */}
        <div className="bg-gray-50 rounded border border-gray-100 p-2 flex flex-col gap-2">
          <span className="font-label-sm text-[10px] text-gray-400 uppercase">Called By Node</span>
          <div className="flex items-center gap-2">
            <select
              className="bg-white border border-gray-200 rounded text-xs text-gray-700 py-1 px-2 focus:ring-1 focus:ring-primary focus:border-primary w-2/3"
              value={form.calledByNode}
              onChange={(e) => update('calledByNode', e.target.value)}
            >
              <option value="">None (Entry point)</option>
              {existingNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.qualifiedName || n.functionName}()</option>
              ))}
            </select>
            <select
              className="bg-white border border-gray-200 rounded text-xs text-gray-700 py-1 px-2 focus:ring-1 focus:ring-primary focus:border-primary w-1/3"
              value={form.calledByType}
              onChange={(e) => update('calledByType', e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="if">If</option>
              <option value="error">Catch</option>
            </select>
          </div>
        </div>
        {/* Calls Node */}
        <div className="bg-gray-50 rounded border border-gray-100 p-2 flex flex-col gap-2">
          <span className="font-label-sm text-[10px] text-gray-400 uppercase">Calls Node</span>
          <div className="flex items-center gap-2">
            <select
              className="bg-white border border-gray-200 rounded text-xs text-gray-700 py-1 px-2 focus:ring-1 focus:ring-primary focus:border-primary w-2/3"
              value={form.callsNode}
              onChange={(e) => update('callsNode', e.target.value)}
            >
              <option value="">Select node...</option>
              {existingNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.qualifiedName || n.functionName}()</option>
              ))}
            </select>
            <select
              className="bg-white border border-gray-200 rounded text-xs text-gray-700 py-1 px-2 focus:ring-1 focus:ring-primary focus:border-primary w-1/3"
              value={form.callsType}
              onChange={(e) => update('callsType', e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="if">If</option>
              <option value="error">Catch</option>
            </select>
          </div>
        </div>
      </div>
      <div className="bg-gray-50 p-3 border-t border-gray-100 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-200 text-xs font-label-sm text-gray-700 hover:bg-gray-100 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!form.functionName.trim()}
          className="px-3 py-1.5 rounded bg-primary text-white text-xs font-label-sm hover:opacity-90 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create Node
        </button>
      </div>
    </div>
  );
}

// --- Minimap ---

// --- File Tree (Explorer panel) ---

function buildFileTreeFromNodes(nodeList) {
  const files = [...new Set(nodeList.map((n) => n.filePath))];
  const root = { children: {} };
  files.forEach((file) => {
    const parts = file.split('/');
    let current = root;
    parts.forEach((part, idx) => {
      if (idx === parts.length - 1) {
        current.children[part] = { type: 'file', name: part };
      } else {
        if (!current.children[part]) {
          current.children[part] = { type: 'folder', name: part, children: {} };
        }
        current = current.children[part];
      }
    });
  });
  function flatten(node) {
    return Object.values(node.children).map((c) =>
      c.type === 'folder'
        ? { type: 'folder', name: c.name, children: flatten(c) }
        : c,
    );
  }
  return flatten(root);
}

function FileTree({ nodes, selectedNodeId, selectedFile, onFileOpen, onFunctionSelect }) {
  // Group all nodes by their file path so each file can list its functions
  const nodesByFile = {};
  nodes.forEach((n) => {
    if (!nodesByFile[n.filePath]) nodesByFile[n.filePath] = [];
    nodesByFile[n.filePath].push(n);
  });
  Object.values(nodesByFile).forEach((arr) => arr.sort((a, b) => a.startLine - b.startLine));

  // Build file tree dynamically from current nodes (works for both mock and API data)
  const fileTree = buildFileTreeFromNodes(nodes);

  const renderItem = (item, parentPath = '', depth = 0) => {
    const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
    if (item.type === 'folder') {
      return (
        <TreeFolder key={fullPath} name={item.name} defaultOpen depth={depth}>
          {item.children.map((child) => renderItem(child, fullPath, depth + 1))}
        </TreeFolder>
      );
    }
    return (
      <TreeFileWithFunctions
        key={fullPath}
        name={item.name}
        fullPath={fullPath}
        depth={depth}
        functions={nodesByFile[fullPath] || []}
        selectedNodeId={selectedNodeId}
        selectedFile={selectedFile}
        onFileOpen={onFileOpen}
        onFunctionSelect={onFunctionSelect}
      />
    );
  };

  return (
    <div className="text-[13px] font-inter select-none">
      {fileTree.map((item) => renderItem(item))}
    </div>
  );
}

function TreeFileWithFunctions({ name, fullPath, depth, functions, selectedNodeId, selectedFile, onFileOpen, onFunctionSelect }) {
  // Auto-open if this file is currently selected, OR contains the selected function
  const containsSelected = functions.some((f) => f.id === selectedNodeId);
  const [open, setOpen] = useState(containsSelected || selectedFile === fullPath);
  const fileActive = selectedFile === fullPath;
  const pad = 4 + depth * INDENT_W;
  const hasFunctions = functions.length > 0;

  return (
    <div>
      <div
        className={`relative w-full flex items-center gap-1 transition-colors ${
          fileActive ? 'bg-soft-sage/30 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`}
        style={{ paddingLeft: pad }}
      >
        <IndentGuides depth={depth} />
        {hasFunctions ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 flex items-center justify-center w-4 h-5 text-gray-400 hover:text-gray-700"
          >
            <span
              className="material-symbols-outlined text-[14px] transition-transform duration-150"
              style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            >
              expand_more
            </span>
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={onFileOpen ? () => onFileOpen(fullPath) : undefined}
          className="flex-1 flex items-center gap-1.5 py-[5px] text-left min-w-0"
        >
          <img src={getMaterialFileIcon(name)} alt="" className="w-4 h-4 shrink-0" />
          <span className="truncate flex-1 text-[12px]">{name}</span>
          {hasFunctions && (
            <span className="text-[9px] text-gray-400 font-label-sm pr-1.5">{functions.length}</span>
          )}
        </button>
      </div>
      {open && hasFunctions && (
        <div>
          {functions.map((fn) => (
            <FileFunctionRow
              key={fn.id}
              node={fn}
              depth={depth + 1}
              active={fn.id === selectedNodeId}
              onSelect={onFunctionSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileFunctionRow({ node, depth, active, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const pad = 4 + depth * INDENT_W + 22;
  return (
    <button
      ref={ref}
      onClick={onSelect ? () => onSelect(node.id) : undefined}
      className={`relative w-full flex items-center gap-1.5 py-[3px] text-left transition-colors ${
        active ? 'bg-soft-sage/30 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
      }`}
      style={{ paddingLeft: pad }}
    >
      <IndentGuides depth={depth} />
      <span className={`material-symbols-outlined text-[12px] shrink-0 ${active ? 'text-primary' : 'text-gray-400'}`}>
        {node.icon || 'function'}
      </span>
      <span className="truncate flex-1 text-[11px] code-font" title={node.signature || node.qualifiedName}>
        {node.container ? <span className="text-gray-400">{node.container}.</span> : null}
        {node.functionName}
      </span>
      <span className="text-[9px] text-gray-400 font-label-sm pr-1.5">L{node.startLine}</span>
    </button>
  );
}

// --- Material Icon Theme (PKief/vscode-material-icon-theme, MIT) ---
const MI_CDN = '/icons/material';

const FOLDER_ICONS = {
  src: 'folder-src',
  sources: 'folder-src',
  tests: 'folder-test',
  mocks: 'folder-mock',
  '.github': 'folder-github',
  workflows: 'folder-ci',
  interceptor: 'folder-middleware',
  docs: 'folder-docs',
};

const EXT_ICONS = {
  swift: 'swift',
  ts: 'typescript',
  tsx: 'react_ts',
  js: 'javascript',
  jsx: 'react',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  go: 'go',
  java: 'java',
  plist: 'xml',
  gitignore: 'git',
};

const SPECIAL_FILES = {
  'Package.swift': 'swift',
  'Project.swift': 'swift',
  'LICENSE': 'certificate',
  '.swiftlint.yml': 'yaml',
  '.gitignore': 'git',
  'Makefile': 'makefile',
  'Gemfile': 'ruby',
};

function getMaterialFileIcon(name) {
  if (SPECIAL_FILES[name]) return `${MI_CDN}/${SPECIAL_FILES[name]}.svg`;
  const ext = name.split('.').pop().toLowerCase();
  const icon = EXT_ICONS[ext] || 'file';
  return `${MI_CDN}/${icon}.svg`;
}

function getMaterialFolderIcon(name, open) {
  const key = name.toLowerCase();
  const base = FOLDER_ICONS[key] || 'folder';
  return `${MI_CDN}/${base}${open ? '-open' : ''}.svg`;
}

const INDENT_W = 16;

function IndentGuides({ depth }) {
  return Array.from({ length: depth }, (_, i) => (
    <span
      key={i}
      className="absolute top-0 bottom-0 w-px bg-gray-200"
      style={{ left: 8 + i * INDENT_W }}
    />
  ));
}

function TreeFolder({ name, children, defaultOpen = false, depth = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  const pad = 4 + depth * INDENT_W;

  return (
    <div>
      <button
        className="relative w-full flex items-center gap-1.5 py-[5px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-left"
        style={{ paddingLeft: pad }}
        onClick={() => setOpen((v) => !v)}
      >
        <IndentGuides depth={depth} />
        <span
          className="material-symbols-outlined text-[16px] shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
        <img src={getMaterialFolderIcon(name, open)} alt="" className="w-4 h-4 shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

function TreeFile({ name, active, onClick, depth = 0 }) {
  const pad = 4 + depth * INDENT_W + 22;
  return (
    <button
      className={`relative w-full flex items-center gap-1.5 py-[5px] text-left transition-colors ${
        active ? 'text-gray-900 bg-soft-sage/30' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
      }`}
      style={{ paddingLeft: pad }}
      onClick={onClick}
    >
      <IndentGuides depth={depth} />
      <img src={getMaterialFileIcon(name)} alt="" className="w-4 h-4 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

// --- Minimap ---

const MINIMAP_INNER_W = 176; // w-48 minus p-2 padding
const MINIMAP_INNER_H = 112;

function Minimap({ nodes, selectedNodeId, zoom, pan, canvasSize, onNavigate }) {
  if (nodes.length === 0) return null;

  // World bounds from node positions
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs) - 60;
  const minY = Math.min(...ys) - 60;
  const maxX = Math.max(...xs) + NODE_WIDTH + 60;
  const maxY = Math.max(...ys) + NODE_HEIGHT + 60;
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const scale = Math.min(MINIMAP_INNER_W / worldW, MINIMAP_INNER_H / worldH);

  // Viewport rectangle — which part of the world is visible on screen
  const vpWorldX = -pan.x / zoom;
  const vpWorldY = -pan.y / zoom;
  const vpWorldW = canvasSize.w / zoom;
  const vpWorldH = canvasSize.h / zoom;

  const vpLeft = (vpWorldX - minX) * scale;
  const vpTop = (vpWorldY - minY) * scale;
  const vpWidth = vpWorldW * scale;
  const vpHeight = vpWorldH * scale;

  // Click on minimap → center viewport on that world point
  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = clickX / scale + minX;
    const worldY = clickY / scale + minY;
    onNavigate({
      x: -(worldX * zoom - canvasSize.w / 2),
      y: -(worldY * zoom - canvasSize.h / 2),
    });
  };

  return (
    <div className="absolute bottom-4 left-4 w-48 h-32 glass-panel rounded border border-gray-200 p-2 z-10 hidden lg:block">
      <div
        className="w-full h-full relative border border-gray-200 bg-gray-100 overflow-hidden cursor-pointer"
        onClick={handleClick}
      >
        {/* Node dots */}
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`absolute w-4 h-2 rounded-sm ${
              node.id === selectedNodeId
                ? 'bg-primary'
                : node.icon === 'warning'
                  ? 'bg-error'
                  : 'bg-gray-400'
            }`}
            style={{
              left: (node.position.x - minX) * scale,
              top: (node.position.y - minY) * scale,
            }}
          />
        ))}
        {/* Viewport indicator */}
        <div
          className="absolute border border-gray-400 bg-soft-sage/20 pointer-events-none"
          style={{
            left: vpLeft,
            top: vpTop,
            width: vpWidth,
            height: vpHeight,
          }}
        />
      </div>
    </div>
  );
}
