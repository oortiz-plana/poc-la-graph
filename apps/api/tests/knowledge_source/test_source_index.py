from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

from app.integrations.haystack import HaystackSourceRetriever, RetrievalScope
from app.knowledge.profiles import parse_document_profiles
from app.knowledge.source_index import (
    SourceIndex,
    parse_markdown_passages,
)

LAW_PATH = Path(__file__).parents[4] / "knowledge" / "input" / "ley-2381-de-2024.md"


def document(path: Path = LAW_PATH) -> SimpleNamespace:
    content = path.read_text(encoding="utf-8")
    return SimpleNamespace(
        relative_path=path.name,
        content=content,
        sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )


def test_article_49_is_split_into_line_addressable_list_passages() -> None:
    law = document()
    passages = parse_markdown_passages(
        law.content,
        document=law.relative_path,
        checksum=law.sha256,
        graph_version="v1",
    )
    article = [passage for passage in passages if passage.article == "49"]

    assert {passage.paragraph for passage in article} >= {
        "d)",
        "e)",
        "f)",
        "g)",
        "h)",
        "PARÁGRAFO",
    }
    assert all(passage.start_line <= passage.end_line for passage in article)
    assert any("cónyuge" in passage.text for passage in article)
    assert any("hermanos(as) inválidos(as)" in passage.text for passage in article)


def test_fts_scope_handles_accents_and_checksum_replacement(tmp_path: Path) -> None:
    law = document()
    other = SimpleNamespace(
        relative_path="other.md",
        content="**ARTÍCULO 49.** Beneficiario ajeno.",
        sha256="b" * 64,
    )
    index = SourceIndex(tmp_path / "source.sqlite")
    index.rebuild_version("v1", [law, other])

    results = index.search(
        "pension beneficiarios",
        graph_version="v1",
        documents=[law.relative_path],
        articles=["49"],
    )
    assert results
    assert {result.document for result in results} == {law.relative_path}
    assert {result.article for result in results} == {"49"}
    assert any("Pensión" in result.text for result in results)

    changed = SimpleNamespace(
        relative_path=law.relative_path,
        content="**ARTÍCULO 49.** Texto reemplazado.",
        sha256="c" * 64,
    )
    index.rebuild_version("v1", [changed])
    replaced = index.scoped_passages(
        graph_version="v1", documents=[law.relative_path], articles=["49"]
    )
    assert len(replaced) == 1
    assert replaced[0].checksum == "c" * 64


async def test_haystack_bm25_is_bounded_to_article_and_document(
    tmp_path: Path,
) -> None:
    law = document()
    index_path = tmp_path / "source.sqlite"
    SourceIndex(index_path).rebuild_version("v1", [law])
    retriever = HaystackSourceRetriever(str(index_path), "v1")

    passages = await retriever.retrieve(
        "¿Quiénes son los beneficiarios de la pension?",
        RetrievalScope(documents=[law.relative_path], articles=["49"]),
    )

    assert passages
    assert all(passage.document == law.relative_path for passage in passages)
    assert all(passage.article == "49" for passage in passages)
    text = "\n".join(passage.text for passage in passages)
    assert "cónyuge" in text
    assert "hijos(as)" in text
    assert "padres" in text


async def test_bm25_auto_merging_keeps_bounded_legal_article_context(
    tmp_path: Path,
) -> None:
    law = document()
    other_path = LAW_PATH.with_name("ley-100-de-1993.md")
    other = document(other_path)
    index_path = tmp_path / "source.sqlite"
    SourceIndex(index_path).rebuild_version("v1", [law, other])
    retriever = HaystackSourceRetriever(str(index_path), "v1")

    passages = await retriever.retrieve(
        "¿Quiénes son los posibles beneficiarios de una pensión "
        "en caso de muerte del titular?",
        RetrievalScope(
            documents=[law.relative_path, other.relative_path],
            articles=["47", "48", "49"],
        ),
    )

    assert {passage.document for passage in passages} <= {
        law.relative_path,
        other.relative_path,
    }
    assert {passage.article for passage in passages} <= {"47", "48", "49"}
    assert all(passage.token_count <= 768 for passage in passages)
    text = "\n".join(
        passage.text for passage in passages if passage.document == law.relative_path
    )
    assert "cónyuge" in text
    assert "hijos(as)" in text
    assert "padres" in text


async def test_bm25_finds_survivor_pension_for_natural_death_question(
    tmp_path: Path,
) -> None:
    law_path = LAW_PATH.with_name("ley-100-de-1993.md")
    law = document(law_path)
    index_path = tmp_path / "source.sqlite"
    SourceIndex(index_path).rebuild_version("v1", [law])
    retriever = HaystackSourceRetriever(str(index_path), "v1")

    passages = await retriever.retrieve(
        "¿Cómo se asigna la pensión cuándo una persona fallece según la ley 100?",
        RetrievalScope(documents=[law.relative_path]),
    )

    assert passages
    assert all(passage.document == law.relative_path for passage in passages)
    assert "47" in {passage.article for passage in passages}
    assert any(
        "beneficiarios de la pensión de sobrevivientes" in passage.text.lower()
        for passage in passages
    )


async def test_auto_merge_is_strict_at_threshold_and_never_returns_a_root(
    tmp_path: Path,
) -> None:
    configured = parse_document_profiles(
        """
        {
          "version": 1,
          "defaultProfile": "compact",
          "rules": [],
          "profiles": {
            "compact": {
              "hardBoundaries": ["page"],
              "leafTokens": 64,
              "parentTokens": 256,
              "overlapTokens": 0,
              "autoMergeThreshold": 0.5
            }
          }
        }
        """
    )
    source = SimpleNamespace(
        relative_path="compact.txt",
        content="needle " * 220,
        sha256="d" * 64,
        media_type="text/plain",
        profile="compact",
    )
    index_path = tmp_path / "source.sqlite"
    SourceIndex(index_path).rebuild_version("v1", [source], profiles=configured)
    retriever = HaystackSourceRetriever(str(index_path), "v1")
    scope = RetrievalScope(documents=["compact.txt"])

    exact_half = await retriever.retrieve("needle", scope, top_k=2)
    above_half = await retriever.retrieve("needle", scope, top_k=3)

    assert len(exact_half) == 2
    assert all(
        item.parent_id is not None and not item.children_ids for item in exact_half
    )
    assert len(above_half) == 1
    assert above_half[0].children_ids
    assert above_half[0].parent_id is None
    assert above_half[0].token_count <= 256
