import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "admin-user",
    roles: new Set(["viewer", "admin"]),
    logout: vi.fn(),
    config: { plsqlEnabled: true },
  }),
}));

import { ApplicationShell } from "./application-shell";

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function currentLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent?.trim());
}

describe("ApplicationShell navigation", () => {
  beforeEach(() => {
    stubMatchMedia();
    state.pathname = "/";
  });

  it.each([
    ["/", "Projects"],
    ["/plsql", "PL/SQL analysis"],
    ["/governance", "Tenant governance"],
  ])("marks only the section for %s as the current page", (pathname, label) => {
    state.pathname = pathname;
    render(
      <ApplicationShell>
        <p>content</p>
      </ApplicationShell>,
    );
    expect(currentLinks()).toEqual([label]);
  });

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

  it("can start with the application navigation collapsed", () => {
    const { container } = render(
      <ApplicationShell defaultSidebarOpen={false}>
        <p>content</p>
      </ApplicationShell>,
    );
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });
});
