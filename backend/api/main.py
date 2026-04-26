import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import re
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File, Cookie
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import tarfile
import zipfile

from api.auth import router as auth_router, get_token_from_cookie

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from llm.use_cases import explain_node, codebase_overview, impact_narrative, chat_with_graph
from ir_compiler.ir_compiler_v3 import (
    build_call_graph,
    predict_impact,
    get_node_with_neighbors,
    hotspots,
    dead_code,
)
from ir_compiler.ir_compiler import safe_to_refactor
from ir_compiler.clustering import compute_clusters, label_clusters_with_llm
from parser import parse_repo
from parser.registry import supported_extensions

GRAPH_PATH = Path(os.environ.get("GRAPH_PATH", str(ROOT / "cached" / "katana.graph.json")))

# All loaded graphs keyed by graph_id
GRAPHS: dict[str, dict] = {}

# Currently active graph (last analyzed or the startup default)
GRAPH: dict = {}

# Cached cluster results keyed by graph_id
CLUSTERS: dict[str, dict] = {}

# Live job state for /analyze, keyed by graph_id. Polled by the frontend
# while a long-running clone+parse is in flight.
JOBS: dict[str, dict] = {}


def _set_job(graph_id: str, stage: str, percent: int, message: str, error: str | None = None) -> None:
    JOBS[graph_id] = {
        "graph_id": graph_id,
        "stage": stage,
        "percent": percent,
        "message": message,
        "error": error,
    }


def _read_snippet(repo_dir: Path, file_rel: str, line: int, before: int = 2, after: int = 25) -> str:
    try:
        with open(repo_dir / file_rel, encoding="utf-8") as f:
            lines = f.readlines()
        start = max(0, line - 1 - before)
        end = min(len(lines), line - 1 + after + 1)
        return "".join(lines[start:end])
    except Exception as e:
        return f"// could not read {file_rel}: {e}"


def _parse_github_url(url: str) -> tuple[str, str]:
    """Extract (owner/repo, repo_name) from a GitHub URL."""
    url = url.strip().rstrip("/").removesuffix(".git")
    m = re.search(r"github\.com[/:]([^/]+)/([^/]+)", url)
    if not m:
        raise ValueError(f"Cannot parse GitHub URL: {url}")
    owner, repo = m.group(1), m.group(2)
    return f"{owner}/{repo}", repo


@asynccontextmanager
async def lifespan(app: FastAPI):
    global GRAPH
    # Load bundled katana graph if available
    if GRAPH_PATH.exists():
        with open(GRAPH_PATH, encoding="utf-8") as f:
            GRAPH = json.load(f)
        graph_id = GRAPH.get("graph_id", "katana")
        GRAPHS[graph_id] = GRAPH
        print(f"[startup] graph '{graph_id}': {len(GRAPH['nodes'])} nodes, {len(GRAPH['edges'])} edges")
    else:
        bundled = ROOT / "cached" / "katana.graph.json"
        if bundled.exists():
            GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(bundled, GRAPH_PATH)
            with open(GRAPH_PATH, encoding="utf-8") as f:
                GRAPH = json.load(f)
            GRAPHS[GRAPH.get("graph_id", "katana")] = GRAPH
            print(f"[startup] seeded from bundled copy")
        else:
            print("[startup] no bundled graph found, starting empty")
    yield

app = FastAPI(
    title="Synapsis API",
    description="Call graph backend with LLM-assisted explanations",
    version="0.1.0",
    lifespan=lifespan,
)

_frontend_origin = os.environ.get("FRONTEND_URL", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

# --- request models ---
class AnalyzeRequest(BaseModel):
    repo_url: str
    force: bool = False

class PredictImpactRequest(BaseModel):
    node_id: str

class ExplainNodeRequest(BaseModel):
    node_id: str

class OverviewRequest(BaseModel):
    pass

class ImpactNarrativeRequest(BaseModel):
    node_id: str

class ChatRequest(BaseModel):
    question: str
    context_node_ids: list[str] = []


class FilterRequest(BaseModel):
    """Filters for narrowing down the call graph.
    All fields are optional — only supplied filters are applied (AND logic).
    """
    categories: list[str] | None = None          # e.g. ["source", "test"]
    function_kinds: list[str] | None = None       # e.g. ["method", "constructor"]
    access_levels: list[str] | None = None        # e.g. ["public", "internal"]
    files: list[str] | None = None                # exact file paths
    file_pattern: str | None = None               # substring match on file path
    containers: list[str] | None = None           # e.g. ["Store", "State"]
    name_pattern: str | None = None               # substring match on function name
    synthetic: bool | None = None
    is_override: bool | None = None
    reachable_from_public_api: bool | None = None
    in_degree_min: int | None = None
    in_degree_max: int | None = None
    out_degree_min: int | None = None
    out_degree_max: int | None = None


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
def analyze(body: AnalyzeRequest, synapsis_sid: str | None = Cookie(default=None)):
    global GRAPH
    try:
        full_name, repo_name = _parse_github_url(body.repo_url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Derive a stable graph_id from the repo name
    graph_id = repo_name.lower().replace("-swift", "").replace("-", "_")

    # If forcing a refresh, drop the cached graph and any associated cluster cache
    if body.force:
        GRAPHS.pop(graph_id, None)
        CLUSTERS.pop(graph_id, None)

    # If already analyzed, return cached
    if graph_id in GRAPHS:
        g = GRAPHS[graph_id]
        GRAPH = g
        return {
            "graph_id": graph_id,
            "status": "ready",
            "node_count": len(g["nodes"]),
            "edge_count": len(g["edges"]),
            "repo_url": g.get("repo_url"),
            "repo_full_name": g.get("repo_full_name"),
        }

    token = get_token_from_cookie(synapsis_sid)
    # Authenticated URL keeps username only; the secret is delivered via
    # GIT_ASKPASS so it never lands in argv / process listings.
    clone_url = (
        f"https://x-access-token@github.com/{full_name}.git"
        if token
        else f"https://github.com/{full_name}.git"
    )

    # Clone into a temp dir
    tmp_dir = tempfile.mkdtemp(prefix="synapsis_")
    clone_path = Path(tmp_dir) / repo_name
    clone_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    if token:
        askpass_path = Path(tmp_dir) / "askpass.sh"
        askpass_path.write_text('#!/bin/sh\nprintf %s "$GH_TOKEN"\n')
        askpass_path.chmod(0o700)
        clone_env["GH_TOKEN"] = token
        clone_env["GIT_ASKPASS"] = str(askpass_path)

    _set_job(graph_id, "cloning", 5, f"Cloning {full_name}...")
    try:
        print(f"[analyze] cloning {full_name} (auth={'yes' if token else 'no'}) ...")
        subprocess.run(
            ["git", "clone", "--depth", "1", clone_url, str(clone_path)],
            check=True,
            capture_output=True,
            timeout=120,
            env=clone_env,
        )

        # Step 1: Parse
        _set_job(graph_id, "parsing", 30, "Parsing source files...")
        print(f"[analyze] parsing ...")
        ir = parse_repo(str(clone_path), repo_name=full_name)

        # Step 2: Build call graph
        _set_job(graph_id, "building", 60, "Building call graph...")
        print(f"[analyze] building call graph ...")
        graph = build_call_graph(ir)
        graph["graph_id"] = graph_id
        graph["repo_url"] = f"https://github.com/{full_name}"
        graph["repo_full_name"] = full_name

        # Step 3: Inline code snippets
        _set_job(graph_id, "snippets", 80, f"Inlining {len(graph['nodes'])} code snippets...")
        snippets_ok = 0
        for node in graph["nodes"]:
            node["code_snippet"] = _read_snippet(clone_path, node["file"], node["line"])
            if not node["code_snippet"].startswith("//"):
                snippets_ok += 1
        print(f"[analyze] {snippets_ok}/{len(graph['nodes'])} snippets inlined")

        # Step 4: Build source file contents for the frontend
        _set_job(graph_id, "snippets", 92, "Loading source files...")
        source_files = {}
        seen_files = set()
        for node in graph["nodes"]:
            if node["file"] not in seen_files:
                seen_files.add(node["file"])
                try:
                    with open(clone_path / node["file"], encoding="utf-8") as f:
                        source_files[node["file"]] = f.read()
                except Exception:
                    pass
        graph["source_files"] = source_files

        # Store
        GRAPHS[graph_id] = graph
        GRAPH = graph

        _set_job(graph_id, "ready", 100, "Done")
        return {
            "graph_id": graph_id,
            "status": "ready",
            "node_count": len(graph["nodes"]),
            "edge_count": len(graph["edges"]),
            "repo_url": graph["repo_url"],
            "repo_full_name": graph["repo_full_name"],
        }
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode()[:500]
        if token:
            stderr = stderr.replace(token, "***")
        _set_job(graph_id, "error", 0, "Clone failed", error=stderr)
        raise HTTPException(400, f"git clone failed: {stderr}")
    except Exception as e:
        _set_job(graph_id, "error", 0, "Analysis failed", error=str(e))
        raise HTTPException(500, f"Analysis failed: {str(e)}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _progress_payload(graph_id: str) -> dict:
    job = JOBS.get(graph_id)
    if job:
        return job
    if graph_id in GRAPHS:
        return {"graph_id": graph_id, "stage": "ready", "percent": 100, "message": "Done", "error": None}
    raise HTTPException(404, f"No analyze job for {graph_id}")


@app.get("/progress/{graph_id}")
def analyze_progress(graph_id: str):
    """Live status for an in-flight or recently-finished /analyze run."""
    return _progress_payload(graph_id)


@app.get("/progress")
def analyze_progress_by_repo(repo_url: str):
    """Same as /progress/{graph_id} but resolves the id from a GitHub URL."""
    try:
        _, repo_name = _parse_github_url(repo_url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    graph_id = repo_name.lower().replace("-swift", "").replace("-", "_")
    return _progress_payload(graph_id)

@app.post("/upload")
async def upload_codebase(file: UploadFile = File(...)):
    global GRAPH

    name = file.filename or "upload"
    ext = Path(name).suffix.lower()
    is_archive = name.endswith(".zip") or name.endswith(".tar") or name.endswith(".tar.gz") or name.endswith(".tgz")
    is_source = ext in supported_extensions()
    if not (is_archive or is_source):
        exts = ", ".join(supported_extensions())
        raise HTTPException(400, f"Unsupported file type. Please upload an archive (.zip, .tar, .tar.gz) or a source file ({exts}).")

    # Derive graph_id from filename
    base = name.split(".")[0]
    graph_id = base.lower().replace("-", "_").replace(" ", "_")

    if graph_id in GRAPHS:
        g = GRAPHS[graph_id]
        GRAPH = g
        return {
            "graph_id": graph_id,
            "status": "ready",
            "node_count": len(g["nodes"]),
            "edge_count": len(g["edges"]),
        }

    tmp_dir = tempfile.mkdtemp(prefix="synapsis_upload_")
    archive_path = Path(tmp_dir) / name
    extract_dir = Path(tmp_dir) / "src"
    extract_dir.mkdir()

    try:
        # Save uploaded file
        content = await file.read()
        with open(archive_path, "wb") as f:
            f.write(content)

        if is_source:
            # Single source file — place it directly in extract_dir
            src_path = extract_dir / name
            src_path.write_bytes(content)
            repo_dir = extract_dir
        else:
            # Extract archive
            if name.endswith(".zip"):
                with zipfile.ZipFile(archive_path, "r") as zf:
                    zf.extractall(extract_dir)
            else:
                with tarfile.open(archive_path, "r:*") as tf:
                    tf.extractall(extract_dir)

            # If the archive contains a single top-level directory, use that
            entries = list(extract_dir.iterdir())
            repo_dir = entries[0] if len(entries) == 1 and entries[0].is_dir() else extract_dir

        # Parse and build
        print(f"[upload] parsing {name} ...")
        ir = parse_repo(str(repo_dir), repo_name=base)

        print(f"[upload] building call graph ...")
        graph = build_call_graph(ir)
        graph["graph_id"] = graph_id

        # Inline code snippets
        snippets_ok = 0
        for node in graph["nodes"]:
            node["code_snippet"] = _read_snippet(repo_dir, node["file"], node["line"])
            if not node["code_snippet"].startswith("//"):
                snippets_ok += 1
        print(f"[upload] {snippets_ok}/{len(graph['nodes'])} snippets inlined")

        # Source files
        source_files = {}
        seen_files = set()
        for node in graph["nodes"]:
            if node["file"] not in seen_files:
                seen_files.add(node["file"])
                try:
                    with open(repo_dir / node["file"], encoding="utf-8") as f:
                        source_files[node["file"]] = f.read()
                except Exception:
                    pass
        graph["source_files"] = source_files

        GRAPHS[graph_id] = graph
        GRAPH = graph

        return {
            "graph_id": graph_id,
            "status": "ready",
            "node_count": len(graph["nodes"]),
            "edge_count": len(graph["edges"]),
        }
    except (zipfile.BadZipFile, tarfile.TarError) as e:
        raise HTTPException(400, f"Failed to extract archive: {e}")
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {str(e)}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.get("/graph/{graph_id}")
def get_graph(graph_id: str):
    g = GRAPHS.get(graph_id)
    if g is None:
        raise HTTPException(404, f"Unknown graph: {graph_id}. Available: {list(GRAPHS.keys())}")
    return g


@app.get("/graph/{graph_id}/repo-info")
def graph_repo_info(graph_id: str):
    g = GRAPHS.get(graph_id)
    if g is None:
        raise HTTPException(404, f"Unknown graph: {graph_id}")
    return {
        "graph_id": graph_id,
        "repo_url": g.get("repo_url"),
        "repo_full_name": g.get("repo_full_name"),
    }

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
        repo_name=GRAPH.get("repo_full_name") or GRAPH.get("repo_url"),
    )


@app.post("/llm/impact-narrative")
def llm_impact_narrative(body: ImpactNarrativeRequest):
    result = _require_node(body.node_id)
    affected = predict_impact(GRAPH, body.node_id)
    return impact_narrative(result["node"], affected)


@app.post("/llm/chat")
def llm_chat(body: ChatRequest):
    if not GRAPH:
        raise HTTPException(400, "No graph loaded. Analyze a repo first.")

    # Gather context nodes
    context_nodes = []
    for nid in body.context_node_ids:
        result = get_node_with_neighbors(GRAPH, nid)
        if result:
            context_nodes.append(result)

    # If no explicit context nodes, auto-select hotspots
    if not context_nodes:
        hot = hotspots(GRAPH, top_n=5)
        for h in hot:
            result = get_node_with_neighbors(GRAPH, h["id"])
            if result:
                context_nodes.append(result)

    # Build metadata summary
    graph_metadata = {
        "node_count": len(GRAPH.get("nodes", [])),
        "edge_count": len(GRAPH.get("edges", [])),
        "hotspots": hotspots(GRAPH, top_n=8),
    }

    # Include clusters if computed
    graph_id = GRAPH.get("graph_id", "")
    cluster_data = CLUSTERS.get(graph_id)
    cluster_summary = cluster_data["clusters"] if cluster_data else None

    return chat_with_graph(
        question=body.question,
        graph_metadata=graph_metadata,
        context_nodes=context_nodes,
        clusters=cluster_summary,
    )


# --- filter endpoint ---
def _apply_filters(nodes: list[dict], f: FilterRequest) -> list[dict]:
    """Apply all non-None filters from FilterRequest to a node list."""
    result = nodes

    if f.categories is not None:
        s = set(f.categories)
        result = [n for n in result if n.get("category") in s]

    if f.function_kinds is not None:
        s = set(f.function_kinds)
        result = [n for n in result if n.get("function_kind") in s]

    if f.access_levels is not None:
        s = set(f.access_levels)
        result = [n for n in result if n.get("access_level") in s]

    if f.files is not None:
        s = set(f.files)
        result = [n for n in result if n.get("file") in s]

    if f.file_pattern is not None:
        pat = f.file_pattern.lower()
        result = [n for n in result if pat in n.get("file", "").lower()]

    if f.containers is not None:
        s = set(f.containers)
        result = [n for n in result if n.get("container") in s]

    if f.name_pattern is not None:
        pat = f.name_pattern.lower()
        result = [n for n in result if pat in n.get("name", "").lower()]

    if f.synthetic is not None:
        result = [n for n in result if n.get("synthetic", False) == f.synthetic]

    if f.is_override is not None:
        result = [n for n in result if n.get("is_override", False) == f.is_override]

    if f.reachable_from_public_api is not None:
        result = [n for n in result if n.get("reachable_from_public_api", False) == f.reachable_from_public_api]

    if f.in_degree_min is not None:
        result = [n for n in result if n.get("in_degree", 0) >= f.in_degree_min]

    if f.in_degree_max is not None:
        result = [n for n in result if n.get("in_degree", 0) <= f.in_degree_max]

    if f.out_degree_min is not None:
        result = [n for n in result if n.get("out_degree", 0) >= f.out_degree_min]

    if f.out_degree_max is not None:
        result = [n for n in result if n.get("out_degree", 0) <= f.out_degree_max]

    return result


@app.post("/graph/{graph_id}/filter")
def filter_graph(graph_id: str, body: FilterRequest):
    g = GRAPHS.get(graph_id)
    if g is None:
        raise HTTPException(404, f"Unknown graph: {graph_id}. Available: {list(GRAPHS.keys())}")

    filtered_nodes = _apply_filters(g["nodes"], body)
    filtered_ids = {n["id"] for n in filtered_nodes}

    # Keep only edges where both source and target are in the filtered set
    filtered_edges = [
        e for e in g["edges"]
        if e["source"] in filtered_ids and e["target"] in filtered_ids
    ]

    return {
        "graph_id": graph_id,
        "total_nodes": len(g["nodes"]),
        "total_edges": len(g["edges"]),
        "filtered_nodes": len(filtered_nodes),
        "filtered_edges": len(filtered_edges),
        "nodes": filtered_nodes,
        "edges": filtered_edges,
    }


@app.get("/graph/{graph_id}/filter-options")
def get_filter_options(graph_id: str):
    """Return all distinct values for each filterable field so the frontend
    can populate dropdowns/checkboxes without scanning the full node list."""
    g = GRAPHS.get(graph_id)
    if g is None:
        raise HTTPException(404, f"Unknown graph: {graph_id}. Available: {list(GRAPHS.keys())}")

    categories = set()
    function_kinds = set()
    access_levels = set()
    files = set()
    containers = set()

    for n in g["nodes"]:
        if v := n.get("category"):
            categories.add(v)
        if v := n.get("function_kind"):
            function_kinds.add(v)
        if v := n.get("access_level"):
            access_levels.add(v)
        if v := n.get("file"):
            files.add(v)
        if v := n.get("container"):
            containers.add(v)

    return {
        "categories": sorted(categories),
        "function_kinds": sorted(function_kinds),
        "access_levels": sorted(access_levels),
        "files": sorted(files),
        "containers": sorted(containers),
    }


# --- cluster endpoints ---
@app.get("/graph/{graph_id}/clusters")
def get_clusters(graph_id: str, ai_labels: bool = False):
    g = GRAPHS.get(graph_id)
    if g is None:
        raise HTTPException(404, f"Unknown graph: {graph_id}. Available: {list(GRAPHS.keys())}")

    # Return cached if available
    if graph_id in CLUSTERS:
        return CLUSTERS[graph_id]

    # Compute clusters
    result = compute_clusters(g)

    # Optionally add AI labels
    if ai_labels:
        try:
            label_clusters_with_llm(result["clusters"], g)
        except Exception:
            pass  # LLM unavailable, keep heuristic labels

    CLUSTERS[graph_id] = result
    return result


# --- safe-to-refactor endpoint ---
@app.get("/query/safe-to-refactor")
def get_safe_to_refactor():
    if not GRAPH:
        raise HTTPException(400, "No graph loaded.")
    results = safe_to_refactor(GRAPH)
    return {"name": "safe_to_refactor", "count": len(results), "results": results}