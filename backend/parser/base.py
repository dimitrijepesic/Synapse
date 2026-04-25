from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class FunctionCall:
    target: str
    line: int


@dataclass
class FunctionInfo:
    qualified_name: str
    name: str
    line_start: int
    line_end: int
    signature: str
    calls: list[FunctionCall] = field(default_factory=list)


@dataclass
class FileResult:
    path: str
    imports: list[str] = field(default_factory=list)
    functions: list[FunctionInfo] = field(default_factory=list)


@dataclass
class ParseResult:
    version: str = "1.0"
    language: str = ""
    repo: str = ""
    files: list[FileResult] = field(default_factory=list)


class BaseParser(ABC):

    @property
    @abstractmethod
    def language(self) -> str:
        """Language name, e.g. 'swift'"""
        ...

    @property
    @abstractmethod
    def extensions(self) -> list[str]:
        """File extensions, e.g. ['.swift']"""
        ...

    @abstractmethod
    def parse_file(self, path: str) -> FileResult:
        """Parse a single file and return a FileResult."""
        ...