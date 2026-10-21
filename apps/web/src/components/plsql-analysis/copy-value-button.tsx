"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Icon button that copies `value` to the clipboard and briefly confirms it,
 * both on the icon and to screen readers. Used in panel headers next to the
 * close button, so copying a qualified name never competes with the actions.
 */
export function CopyValueButton({
  value,
  compact = false,
}: {
  value: string;
  /** Small variant for a button sitting inside a text box. */
  compact?: boolean;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  const Icon = copied ? Check : Copy;
  const label = copied ? t("copied") : t("copy");
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => void copy()}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-selected hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          compact ? "-my-0.5 h-6 w-6" : "h-9 w-9",
        )}
      >
        <Icon aria-hidden className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </>
  );
}
