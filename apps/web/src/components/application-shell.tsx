"use client";

import { CircleCheck, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { LocaleSwitcher } from "./locale-switcher";

export function ApplicationShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const t = useTranslations("shell");

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-primary"
      >
        {t("skipToMain")}
      </a>
      <header className="shrink-0 border-b bg-surface/95 px-4 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{t("appName")}</p>
            <p className="hidden text-xs text-text-muted sm:block">
              {t("tagline")}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-text-secondary md:flex">
              <CircleCheck aria-hidden className="h-4 w-4 text-success" />{" "}
              {t("apiReady")}
            </span>
            <span className="hidden rounded-full border bg-background px-2.5 py-1 text-xs text-text-secondary sm:inline">
              {t("environment")}
            </span>
            <LocaleSwitcher />
            <Button variant="outline" onClick={auth.logout}>
              <LogOut aria-hidden />
              <span className="hidden sm:inline">{t("logOut")}</span>
              <span className="sr-only sm:hidden">{t("logOut")}</span>
            </Button>
          </div>
        </div>
      </header>
      <div
        id="main-content"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        {children}
      </div>
      <footer className="shrink-0 border-t bg-surface px-4 py-1.5 text-center text-[11px] text-[#929292]">
        © 2026 INXN
      </footer>
    </div>
  );
}
