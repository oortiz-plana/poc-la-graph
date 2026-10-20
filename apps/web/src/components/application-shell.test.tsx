import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/i18n/actions", () => ({ setLocale: vi.fn() }));

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
    renderWithIntl(
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
    renderWithIntl(
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
