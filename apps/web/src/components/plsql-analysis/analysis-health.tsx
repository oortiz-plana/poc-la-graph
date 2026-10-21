"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPlsqlHealth } from "@/lib/api";
import type { PlsqlSourceCoordinate } from "@/lib/contracts";
import { HealthPanel } from "./health-panel";

/**
 * Workspace-header entry to Analysis Health: a trigger button with the
 * warning count for the same scope the dialog opens on (the selected object,
 * or the whole repository when none is selected).
 */
export function AnalysisHealth({
  objectId,
  onOpenEvidence,
}: {
  objectId?: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const t = useTranslations("plsqlOverview.analysisHealth");
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    setTotal(undefined);
    getPlsqlHealth(objectId, { limit: 1 })
      .then((health) => {
        if (!cancelled) setTotal(health.total);
      })
      .catch(() => {
        // The dialog surfaces errors; the header badge just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  const scope = objectId ? t("scopeObject") : t("scopeRepository");

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={
          total !== undefined && total > 0
            ? t("triggerLabel", { total, scope })
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <TriangleAlert aria-hidden /> {t("title")}
        {total !== undefined && total > 0 && (
          <span
            aria-hidden
            className="rounded-full bg-warning-surface px-2 py-0.5 text-xs text-warning"
          >
            {total}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pb-3 pt-6">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {/* The list scrolls on its own, so the page controls stay in view. */}
          <div className="overflow-y-auto px-6">
            <HealthPanel objectId={objectId} onOpenEvidence={onOpenEvidence} />
            <div aria-hidden className="h-6" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
