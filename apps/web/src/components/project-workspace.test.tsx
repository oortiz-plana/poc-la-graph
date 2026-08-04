import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectFiles: vi.fn(),
  getProjectBuild: vi.fn(),
  createProject: vi.fn(),
  deleteProjectFile: vi.fn(),
  startProjectBuild: vi.fn(),
  uploadProjectFiles: vi.fn(),
}));

vi.mock("@/lib/api", () => mocks);
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "editor-user",
    roles: new Set(["viewer", "editor"]),
    logout: vi.fn(),
    config: {
      uploadLimits: {
        maxFileBytes: 2 * 1024 * 1024,
        maxFiles: 100,
        maxTotalBytes: 32 * 1024 * 1024,
      },
    },
  }),
}));
vi.mock("./chat-workspace", () => ({
  ChatWorkspace: ({ projectName }: { projectName?: string }) => (
    <div>{projectName}</div>
  ),
}));

import { ProjectWorkspace } from "./project-workspace";

const currentBuild = {
  id: "82434cc5-e5f6-42f1-a664-e63e65ef7c8a",
  status: "building" as const,
  errorCode: null,
  createdAt: "2026-08-04T05:03:25Z",
  startedAt: "2026-08-04T05:03:26Z",
  completedAt: null,
};
const buildingProject: Project = {
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
  currentBuild,
  lastBuild: null,
  allowedActions: {
    createConversation: false,
    editDraft: false,
    build: false,
    archive: false,
    restore: false,
    purge: false,
  },
};

describe("ProjectWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue([buildingProject]);
    mocks.listProjectFiles.mockRejectedValue(new Error("Draft is sealed"));
    mocks.getProjectBuild.mockReturnValue(new Promise(() => undefined));
  });

  it("makes an in-progress build clear and prevents another build", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace />);

    expect(
      await screen.findByLabelText("Build status: Indexing"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Legal knowledge/i }));

    expect(
      await screen.findByRole("button", { name: "Indexing in progress" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/building the knowledge graph, and indexing evidence/i),
    ).toBeInTheDocument();
    expect(mocks.startProjectBuild).not.toHaveBeenCalled();
  });
});
