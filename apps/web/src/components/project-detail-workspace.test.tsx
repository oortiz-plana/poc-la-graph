import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, SnapshotFile } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectFiles: vi.fn(),
  deleteProjectFile: vi.fn(),
  getProjectBuild: vi.fn(),
  getProjectAccessContext: vi.fn(),
  startProjectBuild: vi.fn(),
  uploadProjectFiles: vi.fn(),
  validateUploadSelection: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectAccessRequests: vi.fn(),
  listProjectAccessActivity: vi.fn(),
  searchDirectory: vi.fn(),
  addProjectMembers: vi.fn(),
  changeProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
  decideProjectAccessRequest: vi.fn(),
  requestProjectAccess: vi.fn(),
  cancelProjectAccessRequest: vi.fn(),
}));

vi.mock("@/lib/api", () => mocks);
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "owner-user",
    roles: new Set(["viewer", "editor"]),
    logout: vi.fn(),
    config: {
      uploadLimits: {
        maxFileBytes: 2 * 1024 * 1024,
        maxFiles: 10,
        maxTotalBytes: 8 * 1024 * 1024,
      },
    },
  }),
}));

import { ProjectDetailWorkspace } from "./project-detail-workspace";

const project: Project = {
  id: "5ab3495a-51f0-43b8-a8af-d499cc9a5ba2",
  name: "Legal knowledge",
  description: "Colombian pension legislation",
  state: "draft",
  creator: "owner-user",
  createdAt: "2026-08-04T05:00:00Z",
  updatedAt: "2026-08-04T05:03:26Z",
  archivedAt: null,
  activeGraphVersion: null,
  draftFileCount: 1,
  activeDocumentCount: 0,
  currentBuild: null,
  lastBuild: null,
  allowedActions: {
    createConversation: false,
    editDraft: true,
    build: true,
    archive: true,
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
const storedFile: SnapshotFile = {
  id: "82434cc5-e5f6-42f1-a664-e63e65ef7c8a",
  filename: "law.md",
  mediaType: "text/markdown",
  size: 2048,
  sha256: "a".repeat(64),
};

describe("ProjectDetailWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue([project]);
    mocks.listProjectFiles.mockResolvedValue([storedFile]);
    mocks.validateUploadSelection.mockReturnValue(undefined);
    mocks.uploadProjectFiles.mockResolvedValue([storedFile]);
    mocks.listProjectMembers.mockResolvedValue([
      {
        id: "de2bcfaf-f2fa-41be-a561-8ef75f052b51",
        principalType: "user",
        principalId: "owner-subject",
        displayName: "owner-user",
        role: "owner",
        accessOrigin: "direct",
        createdAt: "2026-08-04T05:00:00Z",
      },
    ]);
    mocks.listProjectAccessRequests.mockResolvedValue([]);
    mocks.listProjectAccessActivity.mockResolvedValue([]);
    mocks.getProjectAccessContext.mockResolvedValue(null);
  });

  it("provides shared routable project navigation", async () => {
    render(
      <ProjectDetailWorkspace projectId={project.id} section="overview" />,
    );

    expect(
      await screen.findByRole("heading", { name: project.name }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Files 1" })).toHaveAttribute(
      "href",
      `/projects/${project.id}?section=documents`,
    );
    expect(
      screen.getByRole("link", { name: "Access & sharing" }),
    ).toHaveAttribute("href", `/projects/${project.id}?section=access`);
    expect(
      screen.getByRole("navigation", { name: "Project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports file selection, validation feedback, removal, and drag and drop", async () => {
    const user = userEvent.setup();
    mocks.validateUploadSelection.mockImplementation((files: File[]) =>
      files.some((file) => file.name.endsWith(".exe"))
        ? "Unsupported document format."
        : undefined,
    );
    render(
      <ProjectDetailWorkspace projectId={project.id} section="documents" />,
    );
    await screen.findByRole("heading", { name: "Documents" });

    const picker = screen.getByRole("button", { name: "Select files" });
    expect(picker).toBeEnabled();
    const input = document.querySelector<HTMLInputElement>(
      "#project-document-picker",
    )!;
    const click = vi.spyOn(input, "click");
    picker.focus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledOnce();
    await user.upload(
      input,
      new File(["valid"], "benefits.pdf", { type: "application/pdf" }),
    );
    fireEvent.drop(screen.getByTestId("upload-zone"), {
      dataTransfer: {
        files: [
          new File(["bad"], "malware.exe", {
            type: "application/octet-stream",
          }),
        ],
      },
    });

    expect(screen.getByText("benefits.pdf")).toBeInTheDocument();
    expect(screen.getByText("malware.exe")).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Remove malware.exe from selection",
      }),
    );
    expect(screen.queryByText("malware.exe")).not.toBeInTheDocument();

    fireEvent.drop(screen.getByTestId("upload-zone"), {
      dataTransfer: {
        files: [new File(["text"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("reports upload progress per selected file", async () => {
    let finish: ((value: SnapshotFile[]) => void) | undefined;
    mocks.uploadProjectFiles.mockImplementation(
      (
        _projectId: string,
        _files: File[],
        progress: (done: number) => void,
      ) => {
        progress(1);
        return new Promise<SnapshotFile[]>((resolve) => {
          finish = resolve;
        });
      },
    );
    const user = userEvent.setup();
    render(
      <ProjectDetailWorkspace projectId={project.id} section="documents" />,
    );
    await screen.findByRole("heading", { name: "Documents" });
    const input = document.querySelector<HTMLInputElement>(
      "#project-document-picker",
    )!;
    await user.upload(input, [
      new File(["a"], "one.md", { type: "text/markdown" }),
      new File(["b"], "two.md", { type: "text/markdown" }),
    ]);
    await user.click(
      screen.getByRole("button", { name: "Upload valid files" }),
    );

    expect(await screen.findByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    finish?.([storedFile]);
  });

  it("shows document lifecycle status and working access management", async () => {
    mocks.listProjects.mockResolvedValue([{ ...project, state: "building" }]);
    const { unmount } = render(
      <ProjectDetailWorkspace projectId={project.id} section="documents" />,
    );
    expect(await screen.findByText("Processing")).toBeInTheDocument();
    unmount();

    render(<ProjectDetailWorkspace projectId={project.id} section="access" />);
    const members = await screen.findByRole("table");
    expect(await within(members).findByText("owner-user")).toBeInTheDocument();
    expect(within(members).getByText("Owner")).toBeInTheDocument();
    expect(within(members).getByText("Direct")).toBeInTheDocument();
    expect(screen.getByText("Owner protection")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add people or groups" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Remove access for owner-user" }),
    ).toBeEnabled();
  });

  it("lets a same-tenant user request access to a private project", async () => {
    const user = userEvent.setup();
    mocks.listProjects.mockResolvedValue([]);
    mocks.getProjectAccessContext.mockResolvedValue({
      projectId: project.id,
      projectName: project.name,
      status: "available",
      requestId: null,
    });
    mocks.requestProjectAccess.mockResolvedValue({
      id: "75ed4e50-0ad9-4b68-b70f-eed48de240f7",
      requesterId: "viewer-subject",
      requesterName: "viewer-user",
      note: "I work on this matter.",
      status: "pending",
      decidedRole: null,
      createdAt: "2026-08-04T06:00:00Z",
      decidedAt: null,
    });

    render(<ProjectDetailWorkspace projectId={project.id} section="access" />);
    expect(
      await screen.findByRole("heading", {
        name: `${project.name} is private`,
      }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: /Message to the project team/ }),
      "I work on this matter.",
    );
    await user.click(screen.getByRole("button", { name: "Request access" }));
    expect(await screen.findByText(/pending review/)).toBeInTheDocument();
  });
});
