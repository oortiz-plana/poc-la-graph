import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Citation } from "@/lib/contracts";
import {
  CitedAnswer,
  citationMarkdown,
  citationPreview,
  uniqueCitations,
} from "./cited-answer";

const citations: Citation[] = [
  {
    id: "source:6800f42bd2da3d039df5ab1a",
    title: "ley-2381-de-2024.md — Artículo 49, d)",
    source: "ley-2381-de-2024.md",
    provenance: "explicit",
    nodeId: null,
    relationship: null,
    excerpt: "Los hijos inválidos mientras subsistan las condiciones.",
    document: "ley-2381-de-2024.md",
    article: "49",
    paragraph: "d)",
    startLine: 844,
    endLine: 844,
  },
];

describe("CitedAnswer", () => {
  it("replaces a raw provider identifier with a numbered citation control", async () => {
    const open = vi.fn();
    render(
      <CitedAnswer
        text={`Los hijos pueden ser beneficiarios. (source:6800f42bd2da3d039df5ab1a)`}
        citations={citations}
        onCitation={open}
      />,
    );

    expect(
      screen.queryByText(/source:6800f42bd2da3d039df5ab1a/),
    ).not.toBeInTheDocument();
    const citation = screen.getByRole("button", {
      name: /Open source 1: Ley 2381 de 2024 · Artículo 49 · líneas 844–844/,
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Ley 2381 de 2024 · Artículo 49 · líneas 844–844",
    );

    await userEvent.click(citation);
    expect(open).toHaveBeenCalledWith(citations[0].id, citation);
  });

  it("reuses a stable number for repeated sources and links numeric markers", () => {
    render(
      <CitedAnswer
        text={`Primera afirmación [source:6800f42bd2da3d039df5ab1a]. Segunda afirmación [1].`}
        citations={[...citations, citations[0]]}
        onCitation={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /Open source 1:/ }),
    ).toHaveLength(2);
    expect(uniqueCitations([...citations, citations[0]])).toHaveLength(1);
  });

  it("removes unmatched raw source identifiers from displayed prose", () => {
    expect(citationMarkdown("Evidence (source:not-returned).", citations)).toBe(
      "Evidence supporting source.",
    );
    expect(citationPreview(citations[0])).toBe(
      "Ley 2381 de 2024 · Artículo 49 · líneas 844–844",
    );
  });
});
