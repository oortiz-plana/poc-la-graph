import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Answer, SnapshotFile } from "@/lib/contracts";
import { ProjectContextPanel } from "./project-context-panel";

const file: SnapshotFile = {
  id: "file-1",
  filename: "TheTrial.md",
  mediaType: "text/markdown",
  size: 450_560,
  sha256: "a".repeat(64),
  status: "indexing",
  progressPercent: 85,
  errorCode: null,
  uploadedAt: "2026-08-04T12:00:00Z",
};

const answer: Answer = {
  requestId: "request-1",
  conversationId: "conversation-1",
  answer: "Grounded answer [1]",
  status: "completed",
  responseType: "answer",
  confidence: "high",
  graphVersion: "version-1",
  citations: [
    {
      id: "source-1",
      title: "TheTrial.md",
      source: "TheTrial.md",
      nodeId: "node-1",
      relationship: null,
      provenance: "explicit",
      excerpt: "Supporting passage",
    },
  ],
  graphEvidence: {
    nodes: [
      {
        id: "node-1",
        label: "Trial",
        type: "Document",
        provenance: "explicit",
      },
    ],
    edges: [],
    paths: [],
  },
  warnings: [],
};

describe("ProjectContextPanel", () => {
  it("shows project files by default with truthful lifecycle progress", () => {
    render(
      <ProjectContextPanel
        mode="panel"
        open
        onOpenChange={vi.fn()}
        onCollapse={vi.fn()}
        projectId="project-1"
        files={[file]}
        canUpload
        tab="files"
        setTab={vi.fn()}
        citations={answer.citations}
        answer={answer}
      />,
    );

    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Files · 1")).toBeInTheDocument();
    expect(screen.getByText("TheTrial.md")).toBeInTheDocument();
    expect(screen.getByText("Indexing").parentElement).toHaveTextContent(
      "Indexing· 85%· 440 KiB",
    );
    expect(
      screen.getByRole("link", { name: /View all files/ }),
    ).toHaveAttribute("href", "/projects/project-1?section=documents");
    expect(screen.getByRole("link", { name: "Upload" })).toHaveAttribute(
      "href",
      "/projects/project-1?section=documents#upload-files",
    );
  });

  it("exposes accessible tabs and collapse control", async () => {
    const setTab = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ProjectContextPanel
        mode="panel"
        open
        onOpenChange={onOpenChange}
        onCollapse={vi.fn()}
        projectId="project-1"
        files={[file]}
        canUpload={false}
        tab="sources"
        setTab={setTab}
        citations={answer.citations}
        answer={answer}
      />,
    );

    expect(screen.getByText("[1] TheTrial.md")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(setTab).toHaveBeenCalledWith("graph");
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse context panel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
