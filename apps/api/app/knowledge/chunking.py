"""Deterministic structural and token-bounded source chunking."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from app.knowledge.profiles import TOKENIZER_ENCODING, DocumentProfile

_ARTICLE = re.compile(r"\bART[IÍ]CULO\s+(\d+[A-Z]?)\b", re.IGNORECASE)
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_MARKER = re.compile(
    r"^\s*(?:[#>*-]+\s*)?\**\s*"
    r"((?:[a-z]\))|(?:\d+[.)])|(?:PAR[ÁA]GRAFO(?:\s+\d+)?))",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class StructuralBlock:
    start: int
    end: int
    page_number: int | None
    section_path: tuple[str, ...]
    article: str | None


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    level: int
    parent_id: str | None
    children_ids: tuple[str, ...]
    token_count: int
    start_char: int
    end_char: int
    start_line: int
    end_line: int
    page_number: int | None
    section_path: tuple[str, ...]
    article: str | None
    paragraph: str | None
    standalone: bool


def tokenizer() -> Any:
    import tiktoken

    return tiktoken.get_encoding(TOKENIZER_ENCODING)


def token_count(text: str) -> int:
    return len(tokenizer().encode(text))  # type: ignore[attr-defined]


def build_chunks(
    text: str,
    *,
    document: str,
    checksum: str,
    profile: DocumentProfile,
) -> list[Chunk]:
    encoding = tokenizer()
    chunks: list[Chunk] = []
    for block in _structural_blocks(text, profile):
        block_text = text[block.start : block.end]
        if not block_text.strip():
            continue
        if len(encoding.encode(block_text)) <= profile.leaf_tokens:
            chunks.append(
                _chunk(
                    text,
                    document,
                    checksum,
                    block,
                    block.start,
                    block.end,
                    level=0,
                    parent_id=None,
                    children_ids=(),
                    standalone=True,
                    encoding=encoding,
                )
            )
            continue
        for parent_start, parent_end in _bounded_ranges(
            block_text, profile.parent_tokens, encoding
        ):
            absolute_start = block.start + parent_start
            absolute_end = block.start + parent_end
            parent_text = text[absolute_start:absolute_end]
            leaf_ranges = _token_windows(
                parent_text,
                profile.leaf_tokens,
                profile.overlap_tokens,
                encoding,
            )
            parent_identity = _identity(
                document, checksum, absolute_start, absolute_end, "parent"
            )
            parent_id = f"source:{parent_identity}"
            leaves = [
                _chunk(
                    text,
                    document,
                    checksum,
                    block,
                    absolute_start + leaf_start,
                    absolute_start + leaf_end,
                    level=1,
                    parent_id=parent_id,
                    children_ids=(),
                    standalone=False,
                    encoding=encoding,
                )
                for leaf_start, leaf_end in leaf_ranges
            ]
            parent = _chunk(
                text,
                document,
                checksum,
                block,
                absolute_start,
                absolute_end,
                level=0,
                parent_id=None,
                children_ids=tuple(leaf.id for leaf in leaves),
                standalone=False,
                encoding=encoding,
                forced_id=parent_id,
            )
            chunks.append(parent)
            chunks.extend(leaves)
    return chunks


def _structural_blocks(text: str, profile: DocumentProfile) -> list[StructuralBlock]:
    boundaries = set(profile.hard_boundaries)
    blocks: list[StructuralBlock] = []
    page = 1
    headings: list[str] = []
    article: str | None = None
    start = 0
    events: dict[int, list[tuple[str, int, str]]] = {}

    def flush(end: int) -> None:
        nonlocal start
        if end > start and text[start:end].strip():
            blocks.append(
                StructuralBlock(
                    start,
                    end,
                    page if "page" in boundaries else None,
                    tuple(headings),
                    article,
                )
            )
        start = end

    if "page" in boundaries:
        for match in re.finditer("\f", text):
            events.setdefault(match.end(), []).append(("page", 0, ""))

    position = 0
    for line in text.splitlines(keepends=True):
        value = line.rstrip("\n\r\f")
        heading_match = _HEADING.match(value)
        article_match = _ARTICLE.search(value)
        if heading_match and "markdown_heading" in boundaries:
            events.setdefault(position, []).append(
                (
                    "heading",
                    len(heading_match.group(1)),
                    heading_match.group(2).strip(),
                )
            )
        if article_match and "legal_article" in boundaries:
            events.setdefault(position, []).append(
                ("article", 0, article_match.group(1).upper())
            )
        position += len(line)

    for position in sorted(events):
        flush(position)
        for event, depth, value in events[position]:
            if event == "page":
                page += 1
                article = None
            elif event == "heading":
                headings = headings[: depth - 1] + [value]
            else:
                article = value
    flush(len(text))
    return blocks


def _bounded_ranges(text: str, limit: int, encoding: object) -> list[tuple[int, int]]:
    ranges = [(0, len(text))]
    patterns = [r"\n\s*\n+", r"(?<=[.!?])\s+", r"\n+", r"\s+"]
    for pattern in patterns:
        next_ranges: list[tuple[int, int]] = []
        for start, end in ranges:
            if len(encoding.encode(text[start:end])) <= limit:  # type: ignore[attr-defined]
                next_ranges.append((start, end))
                continue
            pieces = _split_preserving(text, start, end, pattern)
            next_ranges.extend(_pack_ranges(text, pieces, limit, encoding))
        ranges = next_ranges
    output: list[tuple[int, int]] = []
    for start, end in ranges:
        if len(encoding.encode(text[start:end])) <= limit:  # type: ignore[attr-defined]
            output.append((start, end))
        else:
            output.extend(_token_windows(text[start:end], limit, 0, encoding, start))
    return [(start, end) for start, end in output if text[start:end].strip()]


def _split_preserving(
    text: str, start: int, end: int, pattern: str
) -> list[tuple[int, int]]:
    points = [start]
    points.extend(match.end() for match in re.finditer(pattern, text[start:end]))
    points = [start] + [start + point for point in points[1:]] + [end]
    return [
        (left, right)
        for left, right in zip(points, points[1:], strict=False)
        if right > left
    ]


def _pack_ranges(
    text: str,
    pieces: list[tuple[int, int]],
    limit: int,
    encoding: object,
) -> list[tuple[int, int]]:
    packed: list[tuple[int, int]] = []
    current: tuple[int, int] | None = None
    for piece in pieces:
        proposed = piece if current is None else (current[0], piece[1])
        if (
            current is not None
            and len(encoding.encode(text[proposed[0] : proposed[1]])) > limit  # type: ignore[attr-defined]
        ):
            packed.append(current)
            current = piece
        else:
            current = proposed
    if current is not None:
        packed.append(current)
    return packed


def _token_windows(
    text: str,
    limit: int,
    overlap: int,
    encoding: object,
    base: int = 0,
) -> list[tuple[int, int]]:
    tokens = encoding.encode(text)  # type: ignore[attr-defined]
    if not tokens:
        return []
    decoded, offsets = encoding.decode_with_offsets(tokens)  # type: ignore[attr-defined]
    if decoded != text:
        raise ValueError("Tokenizer offset decoding did not preserve source text")
    result: list[tuple[int, int]] = []
    step = limit - overlap
    for token_start in range(0, len(tokens), step):
        token_end = min(token_start + limit, len(tokens))
        char_start = offsets[token_start]
        char_end = offsets[token_end] if token_end < len(offsets) else len(text)
        result.append((base + char_start, base + char_end))
        if token_end == len(tokens):
            break
    return result


def _chunk(
    full_text: str,
    document: str,
    checksum: str,
    block: StructuralBlock,
    start: int,
    end: int,
    *,
    level: int,
    parent_id: str | None,
    children_ids: tuple[str, ...],
    standalone: bool,
    encoding: object,
    forced_id: str | None = None,
) -> Chunk:
    value = full_text[start:end]
    marker = _MARKER.match(value)
    return Chunk(
        id=forced_id
        or f"source:{_identity(document, checksum, start, end, f'leaf-{level}')}",
        text=value,
        level=level,
        parent_id=parent_id,
        children_ids=children_ids,
        token_count=len(encoding.encode(value)),  # type: ignore[attr-defined]
        start_char=start,
        end_char=end,
        start_line=full_text.count("\n", 0, start) + 1,
        end_line=full_text.count("\n", 0, max(start, end - 1)) + 1,
        page_number=block.page_number,
        section_path=block.section_path,
        article=block.article,
        paragraph=marker.group(1).strip() if marker else None,
        standalone=standalone,
    )


def _identity(document: str, checksum: str, start: int, end: int, kind: str) -> str:
    value = f"{document}\0{checksum}\0{start}\0{end}\0{kind}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
