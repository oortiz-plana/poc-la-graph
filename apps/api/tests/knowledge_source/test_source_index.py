from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

from app.integrations.haystack import HaystackSourceRetriever, RetrievalScope
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
    assert "hermanos(as)" in text


async def test_bm25_keeps_the_selected_beneficiary_article_list_together(
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

    assert {passage.document for passage in passages} == {law.relative_path}
    assert {passage.article for passage in passages} == {"49"}
    text = "\n".join(passage.text for passage in passages)
    assert "cónyuge" in text
    assert "hijos(as)" in text
    assert "padres" in text
    assert "hermanos(as)" in text
