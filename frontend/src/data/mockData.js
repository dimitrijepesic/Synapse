// Test fixture: testcase6_sources (Animal Shelter — Swift). Real graph + sources.
import graphJson from '../../test/testcase6_sources/testcase6_output.json';
import animalSwift from '../../test/testcase6_sources/Sources/Animal.swift?raw';
import shelterSwift from '../../test/testcase6_sources/Sources/Shelter.swift?raw';
import shelterTestsSwift from '../../test/testcase6_sources/Tests/ShelterTests.swift?raw';

export const SOURCE_FILES = {
  'Sources/Animal.swift': animalSwift,
  'Sources/Shelter.swift': shelterSwift,
  'Tests/ShelterTests.swift': shelterTestsSwift,
};

const SIG_FLAGS = ['override', 'private', 'fileprivate', 'public', 'static', 'class', 'mutating', 'throws', 'rethrows', 'async', 'final'];

function tagsFromSignature(sig) {
  if (!sig) return [];
  const out = [];
  for (const flag of SIG_FLAGS) {
    if (new RegExp(`\\b${flag}\\b`).test(sig)) out.push(flag);
  }
  return out;
}

function iconFor(node, isSelfRecursive) {
  if (node.category === 'test') return 'science';
  if (isSelfRecursive) return 'loop';
  const sig = node.signature || '';
  if (/\binit\b/.test(sig)) return 'add_circle';
  if (/\bprivate\b/.test(sig)) return 'lock';
  if (/\boverride\b/.test(sig)) return 'subdirectory_arrow_right';
  if (!node.container) return 'function';
  return 'code';
}

function describe(n) {
  if (n.category === 'test') {
    return `XCTest case ${n.qualified_name}${n.return_type ? ` returning ${n.return_type}` : ''}.`;
  }
  const where = n.container ? `Method on ${n.container}` : 'Top-level function';
  const ret = n.return_type ? ` returning ${n.return_type}` : '';
  const params = n.params && n.params.length ? `, ${n.params.length} parameter${n.params.length === 1 ? '' : 's'}` : '';
  return `${where} ${n.name}${ret}${params}.`;
}

function dependenciesFor(n) {
  const parts = [];
  if (n.container) parts.push(n.container);
  (n.params || []).forEach((p) => p.type && parts.push(p.type));
  return [...new Set(parts)].join(', ') || '-';
}

function extractCode(file, line, lineEnd) {
  const src = SOURCE_FILES[file];
  if (!src) return '';
  return src.split('\n').slice(line - 1, lineEnd).join('\n');
}

// --- Pre-pass: detect self-loops + mutual-recursion partners ---

const selfLoops = new Set();
const mutualRec = new Set();
const edgeKey = (s, t) => `${s}→${t}`;
const edgeSet = new Set(graphJson.edges.map((e) => edgeKey(e.source, e.target)));
graphJson.edges.forEach((e) => {
  if (e.source === e.target) {
    selfLoops.add(e.source);
  } else if (edgeSet.has(edgeKey(e.target, e.source))) {
    mutualRec.add(e.source);
    mutualRec.add(e.target);
  }
});

// --- Layered BFS layout (kept stable on first render) ---

function computeLayout(nodes, edges) {
  const inDeg = {}, children = {};
  nodes.forEach((n) => { inDeg[n.id] = 0; children[n.id] = []; });
  edges.forEach((e) => {
    if (e.source === e.target) return;
    inDeg[e.target] = (inDeg[e.target] || 0) + 1;
    children[e.source].push(e.target);
  });
  const roots = nodes.filter((n) => !inDeg[n.id]);
  if (!roots.length) roots.push(nodes[0]);
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
  nodes.forEach((n) => { if (!visited.has(n.id)) depth[n.id] = ++maxD; });
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
  return positions;
}

// --- Build nodes ---

const rawNodes = graphJson.nodes.map((n) => ({
  id: n.id,
  // existing UI shape
  functionName: n.name,
  filePath: n.file,
  complexity: '',
  tags: tagsFromSignature(n.signature),
  position: { x: 0, y: 0 },
  icon: iconFor(n, selfLoops.has(n.id)),
  code: extractCode(n.file, n.line, n.line_end),
  startLine: n.line,
  highlightLine: n.line,
  analysis: {
    description: describe(n),
    dependencies: dependenciesFor(n),
    returnType: n.return_type || 'Void',
    executionTime: '-',
  },
  // new metadata exposed by the graph contract
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

const rawEdges = graphJson.edges.map((e, i) => ({
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

const positions = computeLayout(rawNodes, rawEdges);
export const defaultNodes = rawNodes.map((n) => ({ ...n, position: positions[n.id] || { x: 0, y: 0 } }));
export const defaultEdges = rawEdges;

export const defaultProject = {
  name: graphJson.graph_id, // 'animal-shelter'
  branch: 'main',
};

// --- File tree built from the unique file paths in the graph ---

function buildFileTree(files) {
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

const uniqueFiles = [...new Set(graphJson.nodes.map((n) => n.file))];
export const defaultFileTree = buildFileTree(uniqueFiles);

// First selectable node — first source-category function
export const defaultSelectedNodeId =
  defaultNodes.find((n) => n.category === 'source')?.id || defaultNodes[0]?.id || null;
