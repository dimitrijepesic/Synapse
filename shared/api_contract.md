# API Contract

This is the source of truth for frontend-backend communication. Both sides must match these shapes. If you need to change something here, coordinate with the team.

---

## Data Models

### GraphNode

```json
{
  "id": "src/utils.py:parse_data:42",
  "name": "parse_data",
  "file": "src/utils.py",
  "line_start": 42,
  "line_end": 68,
  "language": "python",
  "code": "def parse_data(raw):\n    ..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique — format: `file:function_name:line_start` |
| `name` | string | Function/method name |
| `file` | string | Relative path from project root |
| `line_start` | int | First line of function |
| `line_end` | int | Last line of function |
| `language` | string | `"python"`, `"javascript"`, `"typescript"`, `"java"`, `"go"` |
| `code` | string | Full source code of the function |

### GraphEdge

```json
{
  "id": "edge_001",
  "source": "src/main.py:process:10",
  "target": "src/utils.py:parse_data:42",
  "condition": "if data.is_valid()",
  "condition_type": "if"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique edge identifier |
| `source` | string | Source node ID (caller) |
| `target` | string | Target node ID (callee) |
| `condition` | string \| null | Human-readable condition text, null if unconditional |
| `condition_type` | string | One of: `"if"`, `"elif"`, `"else"`, `"for"`, `"while"`, `"try"`, `"except"`, `"unconditional"` |

### CallGraph

```json
{
  "project_id": "abc123",
  "nodes": [ ... ],
  "edges": [ ... ],
  "files": ["src/main.py", "src/utils.py"],
  "languages": ["python"]
}
```

---

## Endpoints

### Import

**`POST /api/import`**

Import a repo from GitHub or upload local files.

Request (GitHub):
```json
{ "github_url": "https://github.com/user/repo" }
```

Request (Local upload): `multipart/form-data` with files attached.

Response:
```json
{ "project_id": "abc123" }
```

---

### Graph

**`GET /api/graph/<project_id>`**

Get the full call graph for a parsed project.

Response:
```json
{
  "project_id": "abc123",
  "nodes": [ GraphNode, ... ],
  "edges": [ GraphEdge, ... ],
  "files": ["src/main.py", "src/utils.py"],
  "languages": ["python"]
}
```

---

### Nodes

**`GET /api/node/<node_id>`**

Get a single node's full details.

Response: `GraphNode`

---

**`GET /api/node/<node_id>/adjacent`**

Get all nodes directly connected to this node (1 hop) and their connecting edges. Used for prefetching/caching.

Response:
```json
{
  "nodes": [ GraphNode, ... ],
  "edges": [ GraphEdge, ... ]
}
```

---

### AI

**`POST /api/ai/summarize`**

Generate an AI summary for a function, given its context.

Request:
```json
{
  "node_id": "src/main.py:process:10",
  "code": "def process(data): ...",
  "adjacent_context": [
    { "name": "parse_data", "code": "def parse_data(raw): ...", "relation": "callee" },
    { "name": "main", "code": "def main(): ...", "relation": "caller" }
  ]
}
```

Response:
```json
{
  "summary": "Processes incoming data by validating it and dispatching to parse_data. Called from main as the primary entry point for data handling."
}
```

---

**`POST /api/ai/insert`**

Ask AI to generate a new function and its connections based on a natural language description.

Request:
```json
{
  "project_id": "abc123",
  "description": "Add a caching layer between process() and parse_data() that stores results by input hash",
  "target_location": {
    "after_node": "src/main.py:process:10",
    "before_node": "src/utils.py:parse_data:42"
  }
}
```

Response:
```json
{
  "new_node": GraphNode,
  "new_edges": [ GraphEdge, ... ],
  "removed_edges": ["edge_001"],
  "generated_code": "def cache_lookup(data):\n    ...",
  "updated_graph": CallGraph
}
```

---

### Manual Node Addition

**`POST /api/node/add`**

Manually add a node with specified connections.

Request:
```json
{
  "project_id": "abc123",
  "node": {
    "name": "validate_input",
    "file": "src/validators.py",
    "code": "def validate_input(data):\n    return data is not None",
    "language": "python"
  },
  "edges": [
    { "source": "src/main.py:process:10", "target": "NEW", "condition": "if raw_input", "condition_type": "if" },
    { "source": "NEW", "target": "src/utils.py:parse_data:42", "condition": null, "condition_type": "unconditional" }
  ]
}
```

Response: Updated `CallGraph`

---

### Test Runner

**`POST /api/test/<project_id>`**

Run the imported project's existing test suite.

Response:
```json
{
  "passed": 12,
  "failed": 1,
  "errors": 0,
  "output": "===== 12 passed, 1 failed in 2.34s ====="
}
```

---

## Error Format

All errors return:
```json
{
  "error": "Short description of what went wrong",
  "detail": "Optional longer explanation"
}
```

With appropriate HTTP status codes (400, 404, 500).
