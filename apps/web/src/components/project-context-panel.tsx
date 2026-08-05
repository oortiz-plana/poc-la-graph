"use client";

import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileText,
  LoaderCircle,
  Network,
  PanelRightClose,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import type { Answer, Citation, SnapshotFile } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { EvidenceDrawer } from "./evidence-drawer";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type ContextTab = "files" | "sources" | "graph";

const statusLabels: Record<string, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  validating: "Validating",
  converting: "Converting",
  buildingGraph: "Building graph",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

function FileStatus({ file }: { file: SnapshotFile }) {
  const status = file.status ?? "uploaded";
  const processing = !["uploaded", "ready", "failed"].includes(status);
  const Icon =
    status === "ready"
      ? CircleCheck
      : status === "failed"
        ? CircleAlert
        : processing
          ? LoaderCircle
          : FileText;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
      <Icon
        aria-hidden
        className={cn(
          "h-3.5 w-3.5",
          processing && "animate-spin text-warning",
          status === "ready" && "text-success",
          status === "failed" && "text-error",
        )}
      />
      <span>{statusLabels[status] ?? "Uploaded"}</span>
      {processing && file.progressPercent != null && (
        <span>· {file.progressPercent}%</span>
      )}
      <span>· {formatBytes(file.size)}</span>
    </div>
  );
}

function FilesView({
  projectId,
  files,
  canUpload,
}: {
  projectId: string;
  files: SnapshotFile[];
  canUpload: boolean;
}) {
  const documentsHref = `/projects/${encodeURIComponent(projectId)}?section=documents`;
  return (
    <div className="px-5 py-5">
      <h3 className="text-base font-semibold">Files · {files.length}</h3>
      {files.length ? (
        <ul className="mt-4 divide-y" aria-label="Project files">
          {files.map((file) => (
            <li key={file.id} className="py-3 first:pt-0">
              <p className="break-words text-sm font-medium">{file.filename}</p>
              <FileStatus file={file} />
              {file.status === "failed" && file.errorCode && (
                <p className="mt-1 text-xs text-error">Build failed</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-text-secondary">
          No files have been added to this project.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        <Link
          href={documentsHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-surface px-3 text-sm font-medium hover:bg-background"
        >
          View all files <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
        {canUpload && (
          <Link
            href={`${documentsHref}#upload-files`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover"
          >
            <Upload aria-hidden className="h-4 w-4" /> Upload
          </Link>
        )}
      </div>
    </div>
  );
}

function ContextContent({
  projectId,
  files,
  canUpload,
  tab,
  setTab,
  answer,
  citations,
  selectedCitationId,
  onCollapse,
}: {
  projectId: string;
  files: SnapshotFile[];
  canUpload: boolean;
  tab: ContextTab;
  setTab: (tab: ContextTab) => void;
  answer?: Answer;
  citations: Citation[];
  selectedCitationId?: string;
  onCollapse: () => void;
}) {
  const tabs: Array<{ id: ContextTab; label: string; icon: typeof FileText }> =
    [
      { id: "files", label: "Files", icon: FileText },
      { id: "sources", label: "Sources", icon: BookOpen },
      { id: "graph", label: "Graph", icon: Network },
    ];
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-1 border-b px-3 py-3">
        <div
          className="flex min-w-0 flex-1"
          role="tablist"
          aria-label="Context"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium",
                tab === id
                  ? "bg-selected text-primary"
                  : "text-text-secondary hover:bg-background",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Collapse context panel"
              onClick={onCollapse}
            >
              <PanelRightClose aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse context panel</TooltipContent>
        </Tooltip>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === "files" ? (
          <FilesView
            projectId={projectId}
            files={files}
            canUpload={canUpload}
          />
        ) : (
          <EvidenceDrawer
            mode="content"
            section={tab === "sources" ? "sources" : "graph"}
            answer={answer}
            citations={citations}
            selectedCitationId={selectedCitationId}
            onClose={onCollapse}
          />
        )}
      </div>
    </div>
  );
}

export function ProjectContextPanel({
  mode,
  open,
  onOpenChange,
  ...props
}: ComponentProps<typeof ContextContent> & {
  mode: "panel" | "drawer";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const content = (
    <ContextContent {...props} onCollapse={() => onOpenChange(false)} />
  );
  if (mode === "panel") {
    return open ? (
      <aside
        aria-label="Project context"
        className="h-full min-h-0 w-[clamp(20rem,27vw,30rem)] shrink-0 overflow-hidden border-l bg-surface"
      >
        {content}
      </aside>
    ) : null;
  }
  if (!open) return null;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[min(92dvh,48rem)] w-full gap-0 overflow-hidden rounded-t-lg p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Project context</SheetTitle>
          <SheetDescription>
            Files, sources, and graph evidence
          </SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
