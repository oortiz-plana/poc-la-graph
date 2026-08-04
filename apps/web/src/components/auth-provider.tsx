"use client";

import Keycloak from "keycloak-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getRuntimeConfig, type RuntimeConfig } from "@/lib/api";
import { registerAccessToken } from "@/lib/auth-token";

type AuthState = {
  username: string;
  roles: Set<string>;
  logout: () => void;
  config: RuntimeConfig;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Authentication is not initialized");
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; keycloak: Keycloak; config: RuntimeConfig }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void getRuntimeConfig()
      .then(async (config) => {
        const keycloak = new Keycloak(config.keycloak);
        const authenticated = await keycloak.init({
          onLoad: "login-required",
          pkceMethod: "S256",
          checkLoginIframe: false,
        });
        if (!authenticated) throw new Error("Authentication was not completed");
        registerAccessToken(async () => {
          await keycloak.updateToken(30);
          if (!keycloak.token) throw new Error("The login session expired");
          return keycloak.token;
        });
        keycloak.onTokenExpired = () => void keycloak.updateToken(30);
        if (active) setState({ kind: "ready", keycloak, config });
      })
      .catch(() => {
        if (active)
          setState({
            kind: "error",
            message:
              "Sign-in could not be initialized. Check the Keycloak connection.",
          });
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthState | null>(() => {
    if (state.kind !== "ready") return null;
    const realmRoles = state.keycloak.realmAccess?.roles ?? [];
    const roles = new Set(realmRoles);
    if (roles.has("admin")) roles.add("editor");
    if (roles.has("editor")) roles.add("viewer");
    return {
      username:
        state.keycloak.tokenParsed?.preferred_username?.toString() ??
        "Signed-in user",
      roles,
      logout: () =>
        void state.keycloak.logout({ redirectUri: window.location.origin }),
      config: state.config,
    };
  }, [state]);

  if (state.kind === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        Signing you in…
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
        >
          {state.message}
        </p>
      </main>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
