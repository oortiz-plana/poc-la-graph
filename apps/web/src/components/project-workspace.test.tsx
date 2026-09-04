import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  listProjects: mocks.listProjects,
  createProject: mocks.createProject,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "editor-user",
    roles: new Set(["viewer", "editor"]),
    logout: vi.fn(),
    config: {},
  }),
}));

import { ProjectWorkspace } from "./project-workspace";

const project: Project = {
  id: "5ab3495a-51f0-43b8-a8af-d499cc9a5ba2",
  name: "Legal knowledge",
  description: "Evidence workspace",
  state: "building",
  creator: "editor-user",
  createdAt: "2026-08-04T05:00:00Z",
  updatedAt: "2026-08-04T05:03:26Z",
  archivedAt: null,
  activeGraphVersion: null,
  draftFileCount: 4,
  activeDocumentCount: 0,
  currentBuild: null,
  lastBuild: null,
  allowedActions: {
    createConversation: false,
    editDraft: false,
    build: false,
    archive: false,
    restore: false,
    purge: false,
    manageAccess: true,
    viewAccessActivity: true,
    requestAccess: false,
  },
  currentAccess: {
    effectiveRole: "owner",
    origins: [],
  },
};

const readyProject: Project = {
  ...project,
  id: "4dd1929f-39d5-4505-bc98-834c90f0df65",
  name: "Pension law",
  description: "Colombian pension legislation",
  state: "ready",
  activeDocumentCount: 12,
  draftFileCount: 0,
  updatedAt: "2026-08-05T08:00:00Z",
};

const failedProject: Project = {
  ...project,
  id: "a8bf735c-8dfa-44ac-b5b5-2ba6db7b89ee",
  name: "Kafka evidence",
  description: "Event-stream research",
  state: "failed",
  draftFileCount: 2,
  updatedAt: "2026-08-03T08:00:00Z",
};

const draftProject: Project = {
  ...project,
  id: "94d5dd5b-fef2-4a8e-98d3-991fb501f9e4",
  name: "Benefits research",
  description: null,
  state: "draft",
  draftFileCount: 1,
  updatedAt: "2026-08-02T08:00:00Z",
};

describe("ProjectWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.listProjects.mockResolvedValue([project]);
    mocks.createProject.mockResolvedValue({ ...project, state: "draft" });
  });

  it("routes primary and overflow actions to the dedicated workspace", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace />);

    expect(
      await screen.findByLabelText("Build status: Indexing"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute(
      "href",
      `/projects/${project.id}?section=builds`,
    );
    await user.click(
      screen.getByRole("button", { name: `Actions for ${project.name}` }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Project details" }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
    expect(
      screen.getByRole("menuitem", { name: "Manage access" }),
    ).toHaveAttribute("href", `/projects/${project.id}?section=access`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("searches and filters projects with explicit status group counts", async () => {
    const user = userEvent.setup();
    mocks.listProjects.mockResolvedValue([
      project,
      readyProject,
      failedProject,
      draftProject,
    ]);
    render(<ProjectWorkspace />);

    expect(await screen.findByRole("button", { name: "All 4" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ready 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Setup 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Attention 1" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Attention 1" }));
    expect(screen.getByText("Kafka evidence")).toBeVisible();
    expect(screen.queryByText("Pension law")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?status=attention");

    await user.type(
      screen.getByRole("searchbox", { name: "Search projects" }),
      "missing",
    );
    expect(screen.getByText("No matching projects")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Pension law")).toBeVisible();
    expect(
      screen.queryByText("No description provided."),
    ).not.toBeInTheDocument();
  });

  it("sorts projects and records the selection in the URL", async () => {
    const user = userEvent.setup();
    mocks.listProjects.mockResolvedValue([project, readyProject]);
    render(<ProjectWorkspace />);
    await screen.findByText("Pension law");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort projects" }),
      "documents",
    );

    expect(window.location.search).toBe("?sort=documents");
    const projectNames = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim())
      .filter((name) => name === "Pension law" || name === "Legal knowledge");
    expect(projectNames).toEqual(["Pension law", "Legal knowledge"]);
  });

  it("creates a project and continues in its Documents section", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace />);
    await screen.findByText("Legal knowledge");

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "Benefits research");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(mocks.createProject).toHaveBeenCalledWith("Benefits research", "");
    expect(mocks.push).toHaveBeenCalledWith(
      `/projects/${project.id}?section=documents`,
    );
  });
});
