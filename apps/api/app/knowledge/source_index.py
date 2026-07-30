"""Versioned SQLite FTS5 index for original legal source passages."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class SourcePassage(BaseModel):
    """A provider-neutral, line-addressable passage from a source document."""

    model_config = ConfigDict(extra="forbid")

    id: str
    document: str
    article: str | None = None
    paragraph: str | None = None
    text: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    checksum: str
    graph_version: str
    score: float | None = None


class IndexableDocument(Protocol):
    relative_path: str
    content: str
    sha256: str


_ARTICLE = re.compile(r"\bART[IÍ]CULO\s+(\d+[A-Z]?)\b", re.IGNORECASE)
_MARKER = re.compile(
    r"^\s*(?:[#>*-]+\s*)?\**\s*"
    r"((?:[a-z]\))|(?:\d+[.)])|(?:PAR[ÁA]GRAFO(?:\s+\d+)?))",
    re.IGNORECASE,
)


def parse_markdown_passages(
    content: str,
    *,
    document: str,
    checksum: str,
    graph_version: str,
) -> list[SourcePassage]:
    """Split Markdown into article-aware paragraph/list blocks."""
    lines = content.splitlines()
    passages: list[SourcePassage] = []
    article: str | None = None
    block: list[str] = []
    block_start = 1

    def flush(end_line: int) -> None:
        nonlocal block
        if not block:
            return
        text = "\n".join(block).strip()
        block = []
        if not text:
            return
        marker = _MARKER.match(text)
        paragraph = marker.group(1).strip() if marker else None
        identity = (
            f"{document}\0{article or ''}\0{paragraph or ''}\0"
            f"{block_start}\0{end_line}\0{checksum}"
        )
        passages.append(
            SourcePassage(
                id=(
                    "source:"
                    + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
                ),
                document=document,
                article=article,
                paragraph=paragraph,
                text=text,
                start_line=block_start,
                end_line=end_line,
                checksum=checksum,
                graph_version=graph_version,
            )
        )

    for number, line in enumerate(lines, start=1):
        article_match = _ARTICLE.search(line)
        if article_match:
            flush(number - 1)
            article = article_match.group(1).upper()
            block_start = number
            block = [line]
            continue
        if not line.strip():
            flush(number - 1)
            continue
        if not block:
            block_start = number
        block.append(line)
    flush(len(lines))
    return passages


class SourceIndex:
    """Canonical durable passage store, partitioned by graph version."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def rebuild_version(
        self, graph_version: str, documents: Iterable[IndexableDocument]
    ) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        try:
            self._initialize(connection)
            passages: list[SourcePassage] = []
            for document in documents:
                passages.extend(
                    parse_markdown_passages(
                        str(document.content),
                        document=str(document.relative_path),
                        checksum=str(document.sha256),
                        graph_version=graph_version,
                    )
                )
            with connection:
                connection.execute(
                    "DELETE FROM source_passages WHERE graph_version = ?",
                    (graph_version,),
                )
                connection.execute(
                    "DELETE FROM source_passages_fts WHERE graph_version = ?",
                    (graph_version,),
                )
                connection.executemany(
                    """
                    INSERT INTO source_passages (
                        id, document, article, paragraph, text, start_line,
                        end_line, checksum, graph_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item.id,
                            item.document,
                            item.article,
                            item.paragraph,
                            item.text,
                            item.start_line,
                            item.end_line,
                            item.checksum,
                            item.graph_version,
                        )
                        for item in passages
                    ],
                )
                connection.executemany(
                    """
                    INSERT INTO source_passages_fts (
                        text, document, article, passage_id, graph_version
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item.text,
                            item.document,
                            item.article or "",
                            item.id,
                            item.graph_version,
                        )
                        for item in passages
                    ],
                )
            return len(passages)
        finally:
            connection.close()

    def has_version(self, graph_version: str) -> bool:
        if not self.path.is_file() or self.path.is_symlink():
            return False
        connection = self._connect_readonly()
        try:
            row = connection.execute(
                "SELECT 1 FROM source_passages WHERE graph_version = ? LIMIT 1",
                (graph_version,),
            ).fetchone()
            return row is not None
        except sqlite3.Error:
            return False
        finally:
            connection.close()

    def scoped_passages(
        self,
        *,
        graph_version: str,
        documents: Sequence[str],
        articles: Sequence[str] = (),
        limit: int = 500,
    ) -> list[SourcePassage]:
        """Load only allowlisted documents/articles for the Haystack bridge."""
        if not documents or not self.path.is_file() or self.path.is_symlink():
            return []
        document_placeholders = ",".join("?" for _ in documents)
        where = [
            "graph_version = ?",
            f"document IN ({document_placeholders})",
        ]
        values: list[object] = [graph_version, *documents]
        if articles:
            article_placeholders = ",".join("?" for _ in articles)
            where.append(f"article IN ({article_placeholders})")
            values.extend(articles)
        values.append(limit)
        connection = self._connect_readonly()
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                f"""
                SELECT id, document, article, paragraph, text, start_line,
                       end_line, checksum, graph_version
                  FROM source_passages
                 WHERE {" AND ".join(where)}
                 ORDER BY document, start_line
                 LIMIT ?
                """,
                values,
            ).fetchall()
        finally:
            connection.close()
        return [SourcePassage.model_validate(dict(row)) for row in rows]

    def search(
        self,
        query: str,
        *,
        graph_version: str,
        documents: Sequence[str],
        articles: Sequence[str] = (),
        limit: int = 100,
    ) -> list[SourcePassage]:
        """Return FTS candidates while enforcing the same immutable scope."""
        tokens = re.findall(r"[\w]+", query, flags=re.UNICODE)
        if not tokens:
            return self.scoped_passages(
                graph_version=graph_version,
                documents=documents,
                articles=articles,
                limit=limit,
            )
        if not documents or not self.path.is_file() or self.path.is_symlink():
            return []
        match_query = " OR ".join(f'"{token}"' for token in tokens[:32])
        document_placeholders = ",".join("?" for _ in documents)
        where = [
            "p.graph_version = ?",
            f"p.document IN ({document_placeholders})",
        ]
        values: list[object] = [match_query, graph_version, *documents]
        if articles:
            article_placeholders = ",".join("?" for _ in articles)
            where.append(f"p.article IN ({article_placeholders})")
            values.extend(articles)
        values.append(limit)
        connection = self._connect_readonly()
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                f"""
                SELECT p.id, p.document, p.article, p.paragraph, p.text,
                       p.start_line, p.end_line, p.checksum, p.graph_version,
                       -bm25(source_passages_fts) AS score
                  FROM source_passages_fts
                  JOIN source_passages AS p
                    ON p.id = source_passages_fts.passage_id
                   AND p.graph_version = source_passages_fts.graph_version
                 WHERE source_passages_fts MATCH ?
                   AND {" AND ".join(where)}
                 ORDER BY bm25(source_passages_fts)
                 LIMIT ?
                """,
                values,
            ).fetchall()
        finally:
            connection.close()
        return [SourcePassage.model_validate(dict(row)) for row in rows]

    @staticmethod
    def _initialize(connection: sqlite3.Connection) -> None:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS source_passages (
                id TEXT NOT NULL,
                document TEXT NOT NULL,
                article TEXT,
                paragraph TEXT,
                text TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                checksum TEXT NOT NULL,
                graph_version TEXT NOT NULL,
                PRIMARY KEY (id, graph_version)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS source_passages_scope
            ON source_passages(graph_version, document, article)
            """
        )
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS source_passages_fts USING fts5(
                text,
                document,
                article,
                passage_id UNINDEXED,
                graph_version UNINDEXED,
                tokenize = 'unicode61 remove_diacritics 2'
            )
            """
        )

    def _connect_readonly(self) -> sqlite3.Connection:
        return sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
