"""Parse Katana with P1, build call graph with P2, write katana.graph.json.

Step 3 inlines code_snippet into each node so the API never needs the source tree.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from parser import parse_repo
from ir_compiler.ir_compiler_v3 import build_call_graph, save_graph

KATANA = ROOT / "data" / "katana"
CACHED = ROOT / "cached"
CACHED.mkdir(parents=True, exist_ok=True)

assert KATANA.exists(), f"Clone Katana to {KATANA} first"


def _read_snippet(file_rel: str, line: int, before: int = 2, after: int = 25) -> str:
    try:
        with open(KATANA / file_rel, encoding="utf-8") as f:
            lines = f.readlines()
        start = max(0, line - 1 - before)
        end = min(len(lines), line - 1 + after + 1)
        return "".join(lines[start:end])
    except Exception as e:
        return f"// could not read {file_rel}: {e}"


print(f"[1/4] Parsing {KATANA} ...")
ir = parse_repo(str(KATANA), repo_name="BendingSpoons/katana-swift")
(CACHED / "katana.ir.json").write_text(json.dumps(ir, indent=2), encoding="utf-8")
print(f"      files={len(ir['files'])} fns={sum(len(f['functions']) for f in ir['files'])}")

print(f"[2/4] Building call graph ...")
graph = build_call_graph(ir)
graph["graph_id"] = "katana"  # P2 derives from repo string; force it

print(f"[3/4] Inlining code snippets ...")
snippets_ok = 0
for node in graph["nodes"]:
    node["code_snippet"] = _read_snippet(node["file"], node["line"])
    if not node["code_snippet"].startswith("//"):
        snippets_ok += 1
print(f"      {snippets_ok}/{len(graph['nodes'])} snippets inlined")

print(f"[4/4] Saving ...")
save_graph(graph, str(CACHED / "katana.graph.json"))