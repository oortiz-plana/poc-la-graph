"use client";

import Link from "next/link";
import {
  Archive,
  CircleCheck,
  Ellipsis,
  FolderKanban,
  LogOut,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  archiveConversation,
  createConversation,
  listConversations,
  purgeConversation,
  renameConversation,
  restoreConversation,
} from "@/lib/api";
import type { ConversationSummary, Project } from "@/lib/contracts";
import { useAuth } from "./auth-provider";
import {
  ProjectNavigation,
  ProjectNavigationHeader,
} from "./project-navigation";

type ProjectSection =
  "overview" | "documents" | "access" | "builds" | "settings";

export function ApplicationShell({
  children,
  project,
  fileCount = 0,
  section,
}: {
  children: ReactNode;
  project?: Project;
  fileCount?: number;
  section?: ProjectSection;
}) {
  const auth = useAuth();
  const navigation = (
    <ApplicationNavigation
      project={project}
      fileCount={fileCount}
      section={section}
    />
  );

  return (
    <SidebarProvider
      className="h-dvh min-h-0 overflow-hidden bg-background"
      style={
        { "--sidebar-width": "clamp(14rem, 18vw, 19rem)" } as CSSProperties
      }
    >
      <Sidebar collapsible="offcanvas" className="border-r bg-surface">
        <SidebarContent>{navigation}</SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0 overflow-hidden">
        <header className="shrink-0 border-b bg-surface/95 px-4 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger
                aria-label="Toggle navigation"
                className="h-11 w-11 [&_svg]:size-5"
              />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  Graphify Knowledge Agent
                </p>
                <p className="hidden text-xs text-text-muted sm:block">
                  Evidence-grounded research workspace
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="hidden items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-text-secondary md:flex">
                <CircleCheck aria-hidden className="h-4 w-4 text-success" /> API
                ready
              </span>
              {project && (
                <span className="hidden rounded-full border bg-background px-2.5 py-1 text-xs capitalize text-text-secondary sm:inline">
                  {project.state}
                </span>
              )}
              <span className="hidden rounded-full border bg-background px-2.5 py-1 text-xs text-text-secondary sm:inline">
                Local
              </span>
              <Button variant="outline" onClick={auth.logout}>
                <LogOut aria-hidden />
                <span className="hidden sm:inline">Log out</span>
                <span className="sr-only sm:hidden">Log out</span>
              </Button>
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ApplicationNavigation({
  project,
  fileCount,
  section,
}: {
  project?: Project;
  fileCount: number;
  section?: ProjectSection;
}) {
  const auth = useAuth();
  if (!project) {
    return (
      <nav aria-label="Application" className="p-4">
        <p className="px-3 text-xs font-medium text-text-muted">Workspace</p>
        <Link
          href="/"
          aria-current="page"
          className="mt-2 flex min-h-11 items-center gap-3 rounded-md bg-selected px-3 text-sm font-medium text-primary"
        >
          <FolderKanban aria-hidden className="h-5 w-5" /> Projects
        </Link>
        {auth.roles.has("admin") && (
          <Link
            href="/governance"
            className="mt-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-text-secondary hover:bg-background"
          >
            <Users aria-hidden className="h-5 w-5" /> Tenant governance
          </Link>
        )}
        {auth.config?.plsqlEnabled && (
          <Link
            href="/plsql"
            className="mt-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-text-secondary hover:bg-background"
          >
            <Network aria-hidden className="h-5 w-5" /> PL/SQL analysis
          </Link>
        )}
      </nav>
    );
  }
  return (
    <ProjectApplicationNavigation
      project={project}
      fileCount={fileCount}
      section={section}
    />
  );
}

function ProjectApplicationNavigation({
  project,
  fileCount,
  section,
}: {
  project: Project;
  fileCount: number;
  section?: ProjectSection;
}) {
  const { setOpenMobile } = useSidebar();
  const [active, setActive] = useState<ConversationSummary[]>([]);
  const [archived, setArchived] = useState<ConversationSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [nextActive, nextArchived] = await Promise.all([
        listConversations(project.id, "active"),
        listConversations(project.id, "archived"),
      ]);
      setActive(nextActive.items);
      setArchived(nextArchived.items);
    } catch {
      setActive([]);
      setArchived([]);
    }
  }, [project.id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const conversations = (showArchived ? archived : active).filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chatHref = `/projects/${encodeURIComponent(project.id)}/chat`;
  async function openConversation(conversation: ConversationSummary) {
    localStorage.setItem(
      `graphify-conversation-id:${project.id}`,
      conversation.id,
    );
    setOpenMobile(false);
    window.location.assign(chatHref);
  }
  async function create() {
    const conversation = await createConversation(project.id);
    await openConversation(conversation);
  }
  async function rename(conversation: ConversationSummary) {
    const name = window.prompt("Conversation name", conversation.name)?.trim();
    if (!name) return;
    await renameConversation(conversation.id, name);
    await refresh();
  }
  async function archiveItem(conversation: ConversationSummary) {
    await archiveConversation(conversation.id);
    await refresh();
  }
  async function restoreItem(conversation: ConversationSummary) {
    await restoreConversation(conversation.id);
    setShowArchived(false);
    await refresh();
  }
  async function deleteItem(conversation: ConversationSummary) {
    if (!window.confirm("Permanently delete this conversation?")) return;
    await purgeConversation(conversation.id);
    await refresh();
  }
  const processing = project.state === "queued" || project.state === "building";
  return (
    <div className="flex min-h-full flex-col overflow-y-auto p-4">
      <ProjectNavigationHeader
        projectId={project.id}
        projectName={project.name}
      />
      <ProjectNavigation
        projectId={project.id}
        selected={section}
        fileCount={fileCount}
        processing={processing}
      />
      <section
        aria-labelledby="shell-conversations"
        className="mt-4 border-t pt-4"
      >
        <h2
          id="shell-conversations"
          className="px-2 text-xs font-semibold text-text-muted"
        >
          Conversations
        </h2>
        <Button
          className="mt-2 w-full justify-start"
          onClick={() => void create()}
        >
          <Plus aria-hidden /> New conversation
        </Button>
        <label className="relative mt-2 block">
          <span className="sr-only">Search conversations</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-h-11 w-full rounded-md border bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <div
          className="mt-3 flex gap-2"
          role="group"
          aria-label="Conversation state"
        >
          <Button
            size="sm"
            variant={showArchived ? "outline" : "secondary"}
            onClick={() => setShowArchived(false)}
          >
            Active
          </Button>
          <Button
            size="sm"
            variant={showArchived ? "secondary" : "outline"}
            onClick={() => setShowArchived(true)}
          >
            Archived ({archived.length})
          </Button>
        </div>
        <ul
          className="mt-3 space-y-1"
          aria-label={
            showArchived ? "Archived conversations" : "Active conversations"
          }
        >
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className="flex min-w-0 items-center rounded-md hover:bg-background"
            >
              {showArchived ? (
                <span className="min-w-0 flex-1 truncate px-2 text-sm">
                  {conversation.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void openConversation(conversation)}
                  className="min-h-11 min-w-0 flex-1 truncate px-2 text-left text-sm font-medium"
                >
                  <MessageSquare
                    aria-hidden
                    className="mr-2 inline h-4 w-4 text-text-muted"
                  />
                  {conversation.name}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Actions for ${conversation.name}`}
                  >
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showArchived ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => void restoreItem(conversation)}
                      >
                        <Undo2 aria-hidden /> Restore
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-error"
                        onSelect={() => void deleteItem(conversation)}
                      >
                        <Trash2 aria-hidden /> Delete
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onSelect={() => void rename(conversation)}
                      >
                        <Pencil aria-hidden /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-error"
                        onSelect={() => void archiveItem(conversation)}
                      >
                        <Archive aria-hidden /> Archive
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
