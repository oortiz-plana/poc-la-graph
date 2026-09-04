import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  LoaderCircle,
  MessageSquare,
  Network,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export type ProjectNavigationSection =
  "overview" | "conversation" | "documents" | "access" | "builds" | "settings";

export function ProjectNavigationHeader({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  return (
    <>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text-secondary hover:bg-background"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> All projects
      </Link>
      <Link
        href={`/projects/${encodeURIComponent(projectId)}`}
        className="mt-1 break-words px-2 py-2 text-base font-semibold leading-5 hover:text-primary"
        title={projectName}
      >
        {projectName}
      </Link>
    </>
  );
}

export function ProjectNavigation({
  projectId,
  selected,
  fileCount = 0,
  processing = false,
}: {
  projectId: string;
  selected?: ProjectNavigationSection;
  fileCount?: number;
  processing?: boolean;
}) {
  const projectHref = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <nav aria-label="Project" className="mt-2 border-t pt-3">
      <ProjectNavigationLink
        href={`${projectHref}/chat`}
        icon={MessageSquare}
        label="Conversation"
        selected={selected === "conversation"}
      />
      <ProjectNavigationLink
        href={`${projectHref}?section=documents`}
        icon={FileText}
        label="Files"
        selected={selected === "documents"}
        suffix={
          processing ? (
            <LoaderCircle
              aria-label="Processing"
              className="h-4 w-4 animate-spin text-warning"
            />
          ) : (
            fileCount
          )
        }
      />
      <ProjectNavigationLink
        href={`${projectHref}?section=builds`}
        icon={Network}
        label="Knowledge"
        selected={selected === "builds"}
      />
      <ProjectNavigationLink
        href={`${projectHref}?section=settings`}
        icon={Settings}
        label="Project settings"
        selected={selected === "settings"}
      />
      <ProjectNavigationLink
        href={`${projectHref}?section=access`}
        icon={Users}
        label="Access & sharing"
        selected={selected === "access"}
      />
    </nav>
  );
}

function ProjectNavigationLink({
  href,
  icon: Icon,
  label,
  selected = false,
  suffix,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  suffix?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={`mt-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium ${selected ? "bg-selected text-primary" : "text-text-secondary hover:bg-background"}`}
    >
      <Icon aria-hidden className="h-5 w-5" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {suffix != null && (
        <span className="text-xs text-text-muted">{suffix}</span>
      )}
    </Link>
  );
}
