from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="Synapsis API",
    description="Call graph backend with LLM-assisted explanations",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins = ["*"],
    allow_credentials = True,
    allow_methods = ["*"],
    allow_headers = ["*"],
)

# request models:
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

# health check
@app.get("/health")
def health():
    return{"ok": True}

# endpoints for graphs
@app.post("/analyze")
def analyze(body: AnalyzeRequest):
    return {"status": "not implemented", "received": body.repo_url}

@app.get("/graph/{graph_id}")
def get_graph(graph_id: str):
    return {"status": "not implemented", "graph_id": graph_id}

@app.get("/node/{node_id}")
def get_node(node_id: str):
    return {"status": "not implemented", "graph_id": node_id}

@app.post("/predict-impact")
def predict_impact(body: PredictImpactRequest):
    return {"status": "not implemented", "node_id": body.node_id}

@app.get("/query/{name}")
def get_query(name: str):
    return {"status": "not implemented", "name": name}

# llm endpoints
@app.post("/llm/explain-node")
def llm_explain_node(body: ExplainNodeRequest):
    return {"status": "not implemented", "node_id": body.node_id}

@app.post("/llm/overview")
def llm_overview(body: OverviewRequest):
    return {"status": "not implemented"}

@app.post("/llm/impact-narrative")
def llm_impact_narrative(body: ImpactNarrativeRequest):
    return {"status": "not implemented", "node_id": body.node_id}