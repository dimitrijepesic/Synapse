from .base import ParseResult, FileResult

def merge(results: list[ParseResult]) -> ParseResult:
    if not results:
        return ParseResult()

    languages = list(dict.fromkeys(r.language for r in results if r.language))

    merged = ParseResult(
        version=results[0].version,
        language=", ".join(languages) if languages else "",
        repo=results[0].repo,
    )
    for result in results:
        merged.files.extend(result.files)
    return merged