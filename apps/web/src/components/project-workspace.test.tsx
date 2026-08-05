import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  listProjects: mocks.listProjects,
  createProject: mocks.createProject,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
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

describe("ProjectWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue([project]);
    mocks.createProject.mockResolvedValue({ ...project, state: "draft" });
  });

  it("routes project actions to the dedicated workspace", async () => {
    render(<ProjectWorkspace />);

    expect(
      await screen.findByLabelText("Build status: Indexing"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute(
      "href",
      `/projects/${project.id}?section=builds`,
    );
    expect(
      screen.getByRole("link", { name: "Project details" }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
