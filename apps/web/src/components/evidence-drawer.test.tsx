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
