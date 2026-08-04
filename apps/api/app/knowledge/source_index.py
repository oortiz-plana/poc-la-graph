"""Versioned SQLite FTS5 index for normalized source text and bounded parents."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.knowledge.chunking import build_chunks
from app.knowledge.profiles import (
    DEFAULT_DOCUMENT_PROFILES_JSON,
    DocumentProfiles,
    parse_document_profiles,
)


class SourcePassage(BaseModel):
    """Provider-neutral passage with hierarchy and normalized-text provenance."""

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
    media_type: str = "text/markdown"
    profile: str = "legacy"
    processing_fingerprint: str | None = None
    level: int = Field(default=0, ge=0)
    parent_id: str | None = None
    children_ids: tuple[str, ...] = ()
    token_count: int = Field(default=0, ge=0)
    start_char: int = Field(default=0, ge=0)
    end_char: int = Field(default=0, ge=0)
    page_number: int | None = Field(default=None, ge=1)
    section_path: tuple[str, ...] = ()
    standalone: bool = True
    auto_merge_threshold: float = Field(default=0.5, gt=0, lt=1)


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
    """Compatibility parser retained for callers that require flat paragraphs."""
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
                id="source:"
                + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24],
                document=document,
                article=article,
                paragraph=paragraph,
                text=text,
                start_line=block_start,
                end_line=end_line,
                start_char=0,
                end_char=len(text),
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
    """Canonical durable source store, partitioned by graph version."""

    _NEW_COLUMNS: dict[str, str] = {
        "media_type": "TEXT NOT NULL DEFAULT 'text/markdown'",
        "profile": "TEXT NOT NULL DEFAULT 'legacy'",
        "processing_fingerprint": "TEXT",
        "level": "INTEGER NOT NULL DEFAULT 0",
        "parent_id": "TEXT",
        "children_ids": "TEXT NOT NULL DEFAULT '[]'",
        "token_count": "INTEGER NOT NULL DEFAULT 0",
        "start_char": "INTEGER NOT NULL DEFAULT 0",
        "end_char": "INTEGER NOT NULL DEFAULT 0",
        "page_number": "INTEGER",
        "section_path": "TEXT NOT NULL DEFAULT '[]'",
        "standalone": "INTEGER NOT NULL DEFAULT 1",
        "is_leaf": "INTEGER NOT NULL DEFAULT 1",
        "auto_merge_threshold": "REAL NOT NULL DEFAULT 0.5",
    }

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def rebuild_version(
        self,
        graph_version: str,
        documents: Iterable[IndexableDocument],
        *,
        profiles: DocumentProfiles | None = None,
        processing_fingerprint: str | None = None,
    ) -> int:
        selected_profiles = profiles or parse_document_profiles(
            DEFAULT_DOCUMENT_PROFILES_JSON
        )
        fingerprint = (
            processing_fingerprint or selected_profiles.processing_fingerprint()
        )
        passages: list[SourcePassage] = []
        for document in documents:
            path = str(document.relative_path)
            # Profiles are selected exclusively from trusted operator rules.
            # Source content or metadata cannot select a splitter configuration.
            profile_name, profile = selected_profiles.select(path)
            media_type = str(getattr(document, "media_type", "text/markdown"))
            for chunk in build_chunks(
                str(document.content),
                document=path,
                checksum=str(document.sha256),
                profile=profile,
            ):
                passages.append(
                    SourcePassage(
                        id=chunk.id,
                        document=path,
                        article=chunk.article,
                        paragraph=chunk.paragraph,
                        text=chunk.text,
                        start_line=chunk.start_line,
                        end_line=chunk.end_line,
                        checksum=str(document.sha256),
                        graph_version=graph_version,
                        media_type=media_type,
                        profile=profile_name,
                        processing_fingerprint=fingerprint,
                        level=chunk.level,
                        parent_id=chunk.parent_id,
                        children_ids=chunk.children_ids,
                        token_count=chunk.token_count,
                        start_char=chunk.start_char,
                        end_char=chunk.end_char,
                        page_number=chunk.page_number,
                        section_path=chunk.section_path,
                        standalone=chunk.standalone,
                        auto_merge_threshold=profile.auto_merge_threshold,
                    )
                )

        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        try:
            self._initialize(connection)
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
                        end_line, checksum, graph_version, media_type, profile,
                        processing_fingerprint, level, parent_id, children_ids,
                        token_count, start_char, end_char, page_number,
                        section_path, standalone, is_leaf, auto_merge_threshold
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?
                    )
                    """,
                    [self._row(item) for item in passages],
                )
                leaves = [item for item in passages if not item.children_ids]
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
                        for item in leaves
                    ],
                )
            return len(leaves)
        finally:
            connection.close()

    def has_version(
        self, graph_version: str, processing_fingerprint: str | None = None
    ) -> bool:
        if not self.path.is_file() or self.path.is_symlink():
            return False
        connection = self._connect_readonly()
        try:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(source_passages)")
            }
            where = "graph_version = ?"
            values: list[object] = [graph_version]
            if processing_fingerprint is not None:
                if "processing_fingerprint" not in columns:
                    return False
                where += " AND processing_fingerprint = ?"
                values.append(processing_fingerprint)
            row = connection.execute(
                f"SELECT 1 FROM source_passages WHERE {where} LIMIT 1", values
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
        if not documents or not self.path.is_file() or self.path.is_symlink():
            return []
        document_placeholders = ",".join("?" for _ in documents)
        where = [
            "graph_version = ?",
            f"document IN ({document_placeholders})",
            "is_leaf = 1",
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
                SELECT {self._SELECT}
                  FROM source_passages
                 WHERE {" AND ".join(where)}
                 ORDER BY document, start_char
                 LIMIT ?
                """,
                values,
            ).fetchall()
        finally:
            connection.close()
        return [self._passage(row) for row in rows]

    def search(
        self,
        query: str,
        *,
        graph_version: str,
        documents: Sequence[str],
        articles: Sequence[str] = (),
        limit: int = 100,
    ) -> list[SourcePassage]:
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
            "p.is_leaf = 1",
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
                SELECT {self._SELECT_PREFIXED},
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
        return [self._passage(row) for row in rows]

    def parents(
        self, *, graph_version: str, parent_ids: Sequence[str]
    ) -> list[SourcePassage]:
        if not parent_ids or not self.path.is_file() or self.path.is_symlink():
            return []
        placeholders = ",".join("?" for _ in parent_ids)
        connection = self._connect_readonly()
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                f"""
                SELECT {self._SELECT}
                  FROM source_passages
                 WHERE graph_version = ?
                   AND id IN ({placeholders})
                   AND is_leaf = 0
                """,
                [graph_version, *parent_ids],
            ).fetchall()
        finally:
            connection.close()
        return [self._passage(row) for row in rows]

    _SELECT = """
        id, document, article, paragraph, text, start_line, end_line, checksum,
        graph_version, media_type, profile, processing_fingerprint, level,
        parent_id, children_ids, token_count, start_char, end_char, page_number,
        section_path, standalone, auto_merge_threshold
    """
    _SELECT_PREFIXED = ", ".join(
        f"p.{name.strip()}"
        for name in _SELECT.replace("\n", " ").split(",")
        if name.strip()
    )

    @classmethod
    def _initialize(cls, connection: sqlite3.Connection) -> None:
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
        existing = {
            row[1] for row in connection.execute("PRAGMA table_info(source_passages)")
        }
        with connection:
            for name, definition in cls._NEW_COLUMNS.items():
                if name not in existing:
                    connection.execute(
                        f"ALTER TABLE source_passages ADD COLUMN {name} {definition}"
                    )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS source_passages_scope
                ON source_passages(graph_version, document, article)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS source_passages_parent
                ON source_passages(graph_version, parent_id)
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

    @staticmethod
    def _row(item: SourcePassage) -> tuple[Any, ...]:
        return (
            item.id,
            item.document,
            item.article,
            item.paragraph,
            item.text,
            item.start_line,
            item.end_line,
            item.checksum,
            item.graph_version,
            item.media_type,
            item.profile,
            item.processing_fingerprint,
            item.level,
            item.parent_id,
            json.dumps(item.children_ids, separators=(",", ":")),
            item.token_count,
            item.start_char,
            item.end_char,
            item.page_number,
            json.dumps(item.section_path, ensure_ascii=False, separators=(",", ":")),
            int(item.standalone),
            int(not item.children_ids),
            item.auto_merge_threshold,
        )

    @staticmethod
    def _passage(row: sqlite3.Row) -> SourcePassage:
        data = dict(row)
        data["children_ids"] = tuple(json.loads(data.pop("children_ids") or "[]"))
        data["section_path"] = tuple(json.loads(data.pop("section_path") or "[]"))
        data["standalone"] = bool(data["standalone"])
        return SourcePassage.model_validate(data)

    def _connect_readonly(self) -> sqlite3.Connection:
        return sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
