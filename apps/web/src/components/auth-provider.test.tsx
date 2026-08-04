import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  updateToken: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("keycloak-js", () => ({
  default: class KeycloakMock {
    token = "access-token";
    tokenParsed = { preferred_username: "editor-user" };
    realmAccess = { roles: ["editor"] };
    onTokenExpired?: () => void;
    init = mocks.init;
    updateToken = mocks.updateToken;
    logout = mocks.logout;
  },
}));
vi.mock("@/lib/api", () => ({ getRuntimeConfig: mocks.getConfig }));
vi.mock("@/lib/auth-token", () => ({ registerAccessToken: mocks.register }));

import { AuthProvider, useAuth } from "./auth-provider";

function ProtectedContent() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.username}</span>
      <span>{auth.roles.has("viewer") ? "viewer" : "not-viewer"}</span>
      <button onClick={auth.logout}>Sign out</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.init.mockResolvedValue(true);
    mocks.updateToken.mockResolvedValue(true);
    mocks.getConfig.mockResolvedValue({
      keycloak: {
        url: "http://localhost:8080",
        realm: "graphify",
        clientId: "graphify-web",
      },
      uploadLimits: {
        maxFileBytes: 2097152,
        maxFiles: 100,
        maxTotalBytes: 33554432,
      },
    });
  });

  it("initializes login-required PKCE, expands roles, and logs out", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <ProtectedContent />
      </AuthProvider>,
    );

    expect(await screen.findByText("editor-user")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
    expect(mocks.init).toHaveBeenCalledWith({
      onLoad: "login-required",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });
    expect(mocks.register).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.logout).toHaveBeenCalledWith({
      redirectUri: window.location.origin,
    });
  });
});
