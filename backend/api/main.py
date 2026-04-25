import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from llm.use_cases import explain_node, codebase_overview, impact_narrative
from ir_compiler.ir_compiler import (
    predict_impact,
    get_node_with_neighbors,
    hotspots,
    dead_code,
)

GRAPH_PATH = Path(os.environ.get("GRAPH_PATH", str(ROOT / "cached" / "katana.graph.json")))

GRAPH: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global GRAPH
    # On first deploy (e.g. Render), copy bundled graph to persistent disk
    if not GRAPH_PATH.exists():
        bundled = ROOT / "cached" / "katana.graph.json"
        if bundled.exists():
            GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(bundled, GRAPH_PATH)
            print(f"[startup] seeded {GRAPH_PATH} from bundled copy")
        else:
            raise RuntimeError(f"Graph file not found at {GRAPH_PATH} and no bundled copy at {bundled}")
    with open(GRAPH_PATH, encoding="utf-8") as f:
        GRAPH = json.load(f)
    print(f"[startup] graph: {len(GRAPH['nodes'])} nodes, {len(GRAPH['edges'])} edges")
    yield

app = FastAPI(
    title="Synapsis API",
    description="Call graph backend with LLM-assisted explanations",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- request models ---
class AnalyzeRequest(BaseModel):
    repo_url: str

class PredictImpactRequest(BaseModel):
    node_id: str

class ExplainNodeRequest(BaseModel):
    node_id: str

class OverviewRequest(BaseModel):
    pass

class ImpactNarrativeRequest(BaseModel):
    node_id: str


# --- helpers ---
def _require_node(node_id: str) -> dict:
    """Look up node in GRAPH or raise 404 with helpful message."""
    result = get_node_with_neighbors(GRAPH, node_id)
    if result is None:
        raise HTTPException(
            404,
            f"Node not found: {node_id}. "
            "Valid IDs available at GET /query/hotspots or GET /graph/katana",
        )
    return result


# --- health ---
@app.get("/health")
def health():
    try:
        c = sqlite3.connect(os.environ.get("CACHE_PATH", "cache.sqlite"))
        cache_count = c.execute("SELECT COUNT(*) FROM llm_cache").fetchone()[0]
        c.close()
    except Exception:
        cache_count = 0
    return {
        "ok": True,
        "node_count": len(GRAPH.get("nodes", [])),
        "edge_count": len(GRAPH.get("edges", [])),
        "cache_entries": cache_count,
    }

# --- graph endpoints ---
@app.post("/analyze")
def analyze(body: AnalyzeRequest):
    # Hackathon: ignore repo_url, always katana
    return {
        "graph_id": "katana",
        "status": "ready",
        "node_count": len(GRAPH["nodes"]),
        "edge_count": len(GRAPH["edges"]),
    }

@app.get("/graph/{graph_id}")
def get_graph(graph_id: str):
    if graph_id != "katana":
        raise HTTPException(404, f"Unknown graph: {graph_id}")
    return GRAPH

@app.get("/node/{node_id:path}")
def get_node(node_id: str):
    result = _require_node(node_id)
    node = result["node"]
    return {
        "node": node,
        "callers": result["callers"],
        "callees": result["callees"],
        "code_snippet": node.get("code_snippet", ""),
    }

@app.post("/predict-impact")
def predict_impact_route(body: PredictImpactRequest):
    _require_node(body.node_id)
    return {"node_id": body.node_id, "affected": predict_impact(GRAPH, body.node_id)}

@app.get("/query/{name}")
def get_query(name: str):
    if name == "hotspots":
        return {"name": "hotspots", "results": hotspots(GRAPH, top_n=15)}
    if name == "dead_code":
        return {"name": "dead_code", "results": dead_code(GRAPH)}
    raise HTTPException(404, f"Unknown query: {name}")

# --- LLM endpoints ---
@app.post("/llm/explain-node")
def llm_explain_node(body: ExplainNodeRequest):
    result = _require_node(body.node_id)
    node = result["node"]
    snippet = node.get("code_snippet", "")
    llm_result = explain_node(node, result["callers"], result["callees"], snippet)
    return {
        "node": node,
        "callers": result["callers"],
        "callees": result["callees"],
        "code_snippet": snippet,
        "explanation": llm_result["explanation"],
        "tokens_used": llm_result["tokens_used"],
        "cached": llm_result["cached"],
    }


@app.post("/llm/overview")
def llm_overview(body: OverviewRequest):
    return codebase_overview(
        top_hotspots=hotspots(GRAPH, top_n=10),
        total_nodes=len(GRAPH["nodes"]),
        total_edges=len(GRAPH["edges"]),
    )


@app.post("/llm/impact-narrative")
def llm_impact_narrative(body: ImpactNarrativeRequest):
    result = _require_node(body.node_id)
    affected = predict_impact(GRAPH, body.node_id)
    return impact_narrative(result["node"], affected)