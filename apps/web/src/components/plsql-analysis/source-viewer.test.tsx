import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceBody } from "./source-viewer";

const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlFileSource }));

vi.mock("./monaco-source-editor", () => ({
  default: (props: { value?: string }) => (
    <pre data-testid="monaco-source-editor">{props.value ?? ""}</pre>
  ),
}));

function problemError(code: string): Error & { code: string } {
  const error = new Error("Request failed.") as Error & { code: string };
  error.code = code;
  return error;
}

describe("SourceBody", () => {
  it("shows the file-size cap message, not the graph-analysis one, for a capped file", async () => {
    getPlsqlFileSource.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(
      <SourceBody
        request={{ kind: "file", fileId: "file://sample/hr/big.sql" }}
      />,
    );

    expect(
      await screen.findByText("This file is too large to preview here."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This project is too large to compute this view right now.",
      ),
    ).not.toBeInTheDocument();
    // Deterministic for this file's size, so no retry is offered.
    expect(
      screen.queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the generic message for other errors", async () => {
    getPlsqlFileSource.mockRejectedValue(problemError("analysis_unavailable"));
    render(
      <SourceBody
        request={{ kind: "file", fileId: "file://sample/hr/x.sql" }}
      />,
    );

    expect(
      await screen.findByText("Analysis is unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry analysis query" }),
    ).toBeInTheDocument();
  });
});
