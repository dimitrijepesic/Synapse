# Services

Business logic layer. Routes call these, never the other way around.

## Files to create

| File | Owner | Purpose |
|------|-------|---------|
| `ast_parser.py` | Person A | Walk tree-sitter AST, extract functions + calls per file |
| `call_graph.py` | Person A | Combine per-file results into a full `CallGraph` with condition tracking |
| `github_client.py` | Person B | Clone GitHub repos to temp directory via gitpython |
| `code_modifier.py` | Person B | Insert/modify functions in source files, re-trigger AST parse |
| `test_runner.py` | Person B | Run imported project's existing tests via subprocess |
| `ai_service.py` | Person D | Gemini 2.5 Flash integration for summaries + node insertion |

## Dependency flow

```
routes → services → models
              ↓
        language_adapters
```

Services import models, never routes. Routes import services, never each other.
