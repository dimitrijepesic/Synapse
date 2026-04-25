# Language Adapters

**Owner:** Person A (AST Engine)

Per-language tree-sitter query definitions. Each adapter knows how to extract functions, calls, and condition contexts from one language's AST.

## Files to create

- `base.py` — abstract `LanguageAdapter` class defining the interface
- `python_adapter.py` — Python tree-sitter queries
- `javascript_adapter.py` — JS/TS tree-sitter queries
- `java_adapter.py` — Java tree-sitter queries

## Interface

Each adapter must implement:

- `get_function_query()` — tree-sitter query for function/method definitions
- `get_call_query()` — tree-sitter query for function calls
- `get_condition_contexts()` — tree-sitter query for if/for/while/try blocks
- `get_language_name()` — returns language string ("python", "javascript", etc.)
- `get_file_extensions()` — returns list of extensions ([".py"], [".js", ".ts"], etc.)
