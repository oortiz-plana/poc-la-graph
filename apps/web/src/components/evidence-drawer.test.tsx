import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EvidenceDrawer } from "./evidence-drawer";
import type { Answer } from "@/lib/contracts";

const answer: Answer = {
  requestId: "req-1",
  conversationId: "conv-1",
  answer: "Ada designed the system.",
  status: "completed",
  responseType: "answer",
  confidence: "high",
  graphVersion: "v7",
  citations: [
    {
      id: "citation-1",
      title: "System notes",
      source: "synthetic.md",
      nodeId: "ada",
      relationship: "DESIGNED",
      provenance: "explicit",
      excerpt: "Ada designed the system.",
    },
  ],
  graphEvidence: {
    nodes: [
      { id: "ada", label: "Ada", type: "Person", provenance: "explicit" },
      {
        id: "system",
        label: "System",
        type: "Project",
        provenance: "extracted",
      },
    ],
    edges: [
      {
        id: "edge-1",
        sourceNodeId: "ada",
        targetNodeId: "system",
        relationship: "DESIGNED",
        provenance: "explicit",
      },
    ],
    paths: [{ id: "path-1", nodeIds: ["ada", "system"], edgeIds: ["edge-1"] }],
  },
  warnings: [],
};

describe("EvidenceDrawer", () => {
  it("keeps a complete sticky header in normal flow above the padded evidence body", () => {
    render(
      <EvidenceDrawer
        answer={answer}
        citations={answer.citations}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByTestId("evidence-header");
    const body = screen.getByTestId("evidence-body");
    const close = screen.getByRole("button", { name: "Close evidence" });

    expect(header).toHaveClass(
      "sticky",
      "top-0",
      "z-20",
      "grid",
      "bg-white",
      "px-5",
      "py-5",
    );
    expect(header).toContainElement(screen.getByText("Grounding details"));
    expect(header).toContainElement(
      screen.getByRole("heading", { name: "Answer evidence" }),
    );
    expect(header).toContainElement(close);
    expect(close).toHaveClass("shrink-0");
    expect(header.className).not.toMatch(
      /(?:^|\s)(?:absolute|fixed|-m[trblxy]?-\S+)/,
    );
    expect(body).toHaveClass("px-5", "pt-6", "pb-6");
    expect(
      header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("presents normalized citations and graph evidence", () => {
    render(
      <EvidenceDrawer
        answer={answer}
        citations={answer.citations}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Answer evidence" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sources (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("[1] System notes")).toBeInTheDocument();
    expect(screen.getByText("Direct evidence")).toBeInTheDocument();
    expect(screen.getByText("Ada designed the system.")).toBeInTheDocument();
    const relationships = screen.getByRole("heading", {
      name: "Relationships (1)",
    }).parentElement!;
    expect(within(relationships).getByRole("listitem")).toHaveTextContent(
      "Ada → DESIGNED → System explicit",
    );
    expect(screen.getByText("Ada → System")).toBeInTheDocument();
  });

  it("announces empty evidence without inventing sources", () => {
    render(<EvidenceDrawer citations={[]} onClose={vi.fn()} />);
    expect(
      screen.getByText("No citations were returned for this answer."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No graph structure was returned for this answer."),
    ).toBeInTheDocument();
  });

  it("expands the complete passage for Haystack source citations", async () => {
    const user = userEvent.setup();
    const passage =
      "Son beneficiarios el cónyuge, los hijos, los padres y los hermanos dependientes.";
    render(
      <EvidenceDrawer
        citations={[
          {
            id: "source:article-49-d",
            title: "ley-2381-de-2024.md — Artículo 49, d)",
            source: "ley-2381-de-2024.md",
            nodeId: null,
            relationship: null,
            provenance: "explicit",
            excerpt: passage,
            document: "ley-2381-de-2024.md",
            article: "49",
            paragraph: "d)",
            startLine: 842,
            endLine: 844,
            pageNumber: 3,
            sectionPath: ["Survivors", "Beneficiaries"],
          },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("[1] Artículo 49, literal d)")).toBeInTheDocument();
    expect(screen.getByText("Direct evidence")).toBeInTheDocument();
    const disclosure = screen.getByText("Open full passage").closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(screen.getByText("Open full passage"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText(passage)).toBeInTheDocument();
    expect(screen.getByText("Ley 2381 de 2024")).toBeInTheDocument();
    expect(screen.getByText("842–844")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Survivors › Beneficiaries")).toBeInTheDocument();
  });

  it("selects, expands, highlights, and scrolls an inline citation into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <EvidenceDrawer
        mode="panel"
        selectedCitationId="source:article-49-d"
        citations={[
          {
            id: "source:article-49-d",
            title: "ley-2381-de-2024.md — Artículo 49, d)",
            source: "ley-2381-de-2024.md",
            nodeId: null,
            relationship: null,
            provenance: "explicit",
            excerpt: "Pasaje jurídico completo.",
            document: "ley-2381-de-2024.md",
            article: "49",
            paragraph: "d)",
            startLine: 844,
            endLine: 844,
          },
        ]}
        onClose={vi.fn()}
      />,
    );

    const card = screen.getByText("[1] Artículo 49, literal d)").closest("li");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-current", "true");
    expect(card).toHaveClass("ring-2");
    expect(
      screen.getByText("Open full passage").closest("details"),
    ).toHaveAttribute("open");
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("keeps raw correlation and node identifiers under technical details", () => {
    render(<EvidenceDrawer citations={answer.citations} onClose={vi.fn()} />);

    const technical = screen
      .getAllByText("Technical details")[0]
      .closest("details");
    expect(technical).not.toHaveAttribute("open");
    expect(within(technical!).getByText("citation-1")).toBeInTheDocument();
    expect(within(technical!).getByText("ada")).toBeInTheDocument();
  });

  it("is keyboard dismissible and moves focus to its heading", async () => {
    const close = vi.fn();
    render(<EvidenceDrawer citations={[]} onClose={close} />);
    expect(
      screen.getByRole("heading", { name: "Answer evidence" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });
});
