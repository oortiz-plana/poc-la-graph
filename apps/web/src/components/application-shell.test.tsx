import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "admin-user",
    roles: new Set(["viewer", "admin"]),
    logout: vi.fn(),
    config: { plsqlEnabled: true },
  }),
}));

import { ApplicationShell } from "./application-shell";

describe("ApplicationShell navigation", () => {
  it("offers a skip link to the main content", () => {
    render(
      <ApplicationShell>
        <p>content</p>
      </ApplicationShell>,
    );
    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByText("content").parentElement).toHaveAttribute(
      "id",
      "main-content",
    );
  });

  it("has no application navigation", () => {
    render(
      <ApplicationShell>
        <p>content</p>
      </ApplicationShell>,
    );
    expect(
      screen.queryByRole("navigation", { name: "Application" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Toggle navigation" }),
    ).not.toBeInTheDocument();
  });
});
