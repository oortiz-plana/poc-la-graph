import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGovernanceProjects: vi.fn(),
  listProjectMembers: vi.fn(),
  addProjectMembers: vi.fn(),
  changeProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
  searchDirectory: vi.fn(),
}));

vi.mock("@/lib/api", () => mocks);
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    username: "tenant-admin",
    roles: new Set(["viewer", "editor", "admin"]),
    logout: vi.fn(),
  }),
}));

import { TenantGovernanceWorkspace } from "./tenant-governance-workspace";

describe("TenantGovernanceWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGovernanceProjects.mockResolvedValue([
      {
        id: "b12617c9-05f8-43b7-8e49-eb2cc197fa87",
        name: "Private legal project",
        state: "ready",
        ownerCount: 1,
        updatedAt: "2026-08-04T06:00:00Z",
      },
    ]);
    mocks.listProjectMembers.mockResolvedValue([
      {
        id: "f994f341-d223-4691-9f4a-a1edb51c16f8",
        principalType: "user",
        principalId: "owner-id",
        displayName: "Project Owner",
        role: "owner",
        accessOrigin: "direct",
        createdAt: "2026-08-04T06:00:00Z",
      },
    ]);
  });

  it("discovers private projects and opens membership without project content", async () => {
    const user = userEvent.setup();
    render(<TenantGovernanceWorkspace />);
    expect(
      await screen.findByRole("heading", { name: "Tenant governance" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /Private legal project/ }),
    );
    expect(await screen.findByText("Project Owner")).toBeInTheDocument();
    expect(screen.queryByText("Documents")).not.toBeInTheDocument();
  });
});
