"use client";

import { TriangleAlert } from "lucide-react";
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
 * repository-wide warning count and a dialog whose scope follows the
 * selected object (repository-wide when none is selected).
 */
export function AnalysisHealth({
  objectId,
  onOpenEvidence,
}: {
  objectId?: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    getPlsqlHealth()
      .then((health) => {
        if (!cancelled) setTotal(health.total);
      })
      .catch(() => {
        // The dialog surfaces errors; the header badge just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <TriangleAlert aria-hidden /> Analysis Health
        {total !== undefined && total > 0 && (
          <span className="rounded-full bg-warning-surface px-2 py-0.5 text-xs text-warning">
            {total}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Analysis Health</DialogTitle>
            <DialogDescription>
              Diagnostics computed while projecting the analyzed corpus.
              They never block navigation.
            </DialogDescription>
          </DialogHeader>
          <HealthPanel objectId={objectId} onOpenEvidence={onOpenEvidence} />
        </DialogContent>
      </Dialog>
    </>
  );
}
