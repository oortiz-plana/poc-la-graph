"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  BookOpen,
  CircleAlert,
  CircleCheck,
  Ellipsis,
  FileText,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Square,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  checkHealth,
  createConversation,
  archiveConversation,
  getRuntimeConfig,
  listConversations,
  listProjectFiles,
  listProjects,
  loadConversation,
  purgeConversation,
  renameConversation,
  restoreConversation,
} from "@/lib/api";
import { authorizationHeaders } from "@/lib/auth-token";
import {
  type Answer,
  type Citation,
  type Conversation,
  type ConversationSummary,
  type Project,
  type SnapshotFile,
  type UIEvent,
  uiEventSchema,
} from "@/lib/contracts";
import { CitedAnswer } from "./cited-answer";
import { useAuth } from "./auth-provider";
import { ProjectContextPanel, type ContextTab } from "./project-context-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Connection = "checking" | "connected" | "unavailable";
const CONVERSATION_KEY = "graphify-conversation-id";

function textOf(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
function eventsOf(message: UIMessage): UIEvent[] {
  return message.parts.flatMap((part) => {
    if (!part.type.startsWith("data-") || !("data" in part)) return [];
    const parsed = uiEventSchema.safeParse(part.data);
    return parsed.success ? [parsed.data] : [];
  });
}
function finalOf(message: UIMessage): Answer | undefined {
  return eventsOf(message).findLast((event) => event.kind === "completed")
    ?.result;
}
function citationsOf(message: UIMessage) {
  const answer = finalOf(message);
  if (answer) return answer.citations;
  return [
    ...new Map(
      eventsOf(message)
        .filter((e) => e.kind === "citation")
        .map((e) => [e.citation.id, e.citation]),
    ).values(),
  ] as Citation[];
}

export function ChatWorkspace({
  projectId: selectedProjectId,
  project: selectedProject,
  projectName: legacyProjectName,
  initialFiles = [],
  onBack,
}: {
  projectId?: string;
  project?: Project;
  projectName?: string;
  initialFiles?: SnapshotFile[];
  onBack?: () => void;
} = {}) {
  const auth = useAuth();
  const [conversationId, setConversationId] = useState<string>();
  const [projectId, setProjectId] = useState(
    selectedProjectId ?? "sample-project",
  );
  const [project, setProject] = useState<Project | undefined>(selectedProject);
  const [files, setFiles] = useState<SnapshotFile[]>(initialFiles);
  const projectName = project?.name ?? legacyProjectName;
  const conversationKey = selectedProjectId
    ? `${CONVERSATION_KEY}:${selectedProjectId}`
    : CONVERSATION_KEY;
  const [connection, setConnection] = useState<Connection>("checking");
  const [draft, setDraft] = useState("");
  const [initError, setInitError] = useState<string>();
  const [continuityNotice, setContinuityNotice] = useState<string>();
  const [selected, setSelected] = useState<UIMessage>();
  const [selectedCitationId, setSelectedCitationId] = useState<string>();
  const [contextTab, setContextTab] = useState<ContextTab>("files");
  const [contextOpen, setContextOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [activeConversations, setActiveConversations] = useState<
    ConversationSummary[]
  >([]);
  const [archivedConversations, setArchivedConversations] = useState<
    ConversationSummary[]
  >([]);
  const [showArchived, setShowArchived] = useState(false);
  const [conversationQuery, setConversationQuery] = useState("");
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [archivedCursor, setArchivedCursor] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const evidenceTrigger = useRef<HTMLElement | null>(null);
  const pendingEvidenceFocus = useRef<{
    citationId?: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const evidenceIsPanel = useMediaQuery("(min-width: 1024px)");
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { conversationId },
        headers: authorizationHeaders,
      }),
    [conversationId],
  );
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    setMessages,
    clearError,
    error,
  } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  const displayConversation = useCallback(
    (conversation: Conversation) => {
      localStorage.setItem(conversationKey, conversation.id);
      setConversationId(conversation.id);
      setMessages(
        conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: [
            { type: "text" as const, text: message.content },
            ...(message.result
              ? [
                  {
                    type: "data-result" as const,
                    data: {
                      kind: "completed" as const,
                      result: message.result,
                    },
                  },
                ]
              : []),
          ],
        })),
      );
      setSelected(undefined);
      setSelectedCitationId(undefined);
    },
    [conversationKey, setMessages],
  );

  const refreshConversationLists = useCallback(
    async (configuredProjectId = projectId) => {
      const [active, archived] = await Promise.all([
        listConversations(configuredProjectId, "active"),
        listConversations(configuredProjectId, "archived"),
      ]);
      setActiveConversations(active.items);
      setArchivedConversations(archived.items);
      setActiveCursor(active.nextCursor);
      setArchivedCursor(archived.nextCursor);
      return active.items;
    },
    [projectId],
  );

  const initialize = useCallback(async () => {
    setConnection("checking");
    setInitError(undefined);
    if (!(await checkHealth())) {
      setConnection("unavailable");
      return;
    }
    try {
      const configuredProjectId =
        selectedProjectId ??
        ((await getRuntimeConfig()) as unknown as { projectId: string })
          .projectId;
      setProjectId(configuredProjectId);
      const stored = localStorage.getItem(conversationKey);
      const active = await refreshConversationLists(configuredProjectId);
      let target = active[0];
      if (stored && !active.some((item) => item.id === stored)) {
        setContinuityNotice(
          "Your previous selection is no longer active. The most recent conversation was opened.",
        );
      }
      let conversation = target ? await loadConversation(target.id) : null;
      if (!conversation) {
        conversation = await createConversation(configuredProjectId);
        target = conversation;
        setActiveConversations([conversation]);
      }
      displayConversation(conversation);
      setConnection("connected");
    } catch {
      setConnection("unavailable");
      setInitError(
        "The API is reachable, but a conversation could not be started.",
      );
    }
  }, [
    conversationKey,
    displayConversation,
    refreshConversationLists,
    selectedProjectId,
  ]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    let timer: number | undefined;
    async function refreshProjectContext() {
      try {
        const [projects, nextFiles] = await Promise.all([
          listProjects(),
          listProjectFiles(selectedProjectId!),
        ]);
        if (cancelled) return;
        const nextProject = projects.find(
          (item) => item.id === selectedProjectId,
        );
        if (nextProject) setProject(nextProject);
        setFiles(nextFiles);
        if (
          nextProject?.state === "queued" ||
          nextProject?.state === "building"
        ) {
          timer = window.setTimeout(() => void refreshProjectContext(), 1000);
        }
      } catch {
        // Conversation availability is independent from contextual file metadata.
      }
    }
    void refreshProjectContext();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [selectedProjectId]);
  useEffect(() => {
    if (!evidenceIsPanel) return;
    const key = `graphify-context-panel-collapsed:${projectId}`;
    setContextOpen(localStorage.getItem(key) !== "true");
  }, [evidenceIsPanel, projectId]);
  useEffect(() => {
    if (connection !== "unavailable") return;
    const timer = window.setInterval(() => void initialize(), 15_000);
    return () => window.clearInterval(timer);
  }, [connection, initialize]);
  useEffect(() => {
    if (connection === "connected" && status === "ready") {
      void refreshConversationLists();
    }
  }, [connection, refreshConversationLists, status]);
  useEffect(() => {
    if (selected || !pendingEvidenceFocus.current) return;
    const pending = pendingEvidenceFocus.current;
    pendingEvidenceFocus.current = null;
    window.requestAnimationFrame(() => {
      const replacement = pending.citationId
        ? [
            ...document.querySelectorAll<HTMLElement>("[data-citation-id]"),
          ].find((element) => element.dataset.citationId === pending.citationId)
        : undefined;
      if (replacement) replacement.focus();
      else if (pending.trigger?.isConnected) pending.trigger.focus();
    });
  }, [selected]);
  const recoveringExpiredConversation = useRef(false);
  useEffect(() => {
    if (
      !error ||
      recoveringExpiredConversation.current ||
      !isExpiredConversationError(error)
    )
      return;
    recoveringExpiredConversation.current = true;
    void createConversation(projectId)
      .then((fresh) => {
        localStorage.setItem(conversationKey, fresh.id);
        setConversationId(fresh.id);
        setMessages([]);
        setSelected(undefined);
        setSelectedCitationId(undefined);
        setDraft(lastQuestion);
        setContinuityNotice(
          "Your previous conversation expired. A new conversation was started, and your question is ready to resend.",
        );
        clearError();
      })
      .catch(() => {
        setInitError(
          "The expired conversation could not be replaced. Check the API connection.",
        );
      })
      .finally(() => {
        recoveringExpiredConversation.current = false;
      });
  }, [
    clearError,
    conversationKey,
    error,
    lastQuestion,
    projectId,
    setMessages,
  ]);

  async function submit(question = draft) {
    const value = question.trim();
    if (!value || busy || connection !== "connected" || !conversationId) return;
    setLastQuestion(value);
    setDraft("");
    await sendMessage({ text: value }, { body: { conversationId } });
  }
  async function selectConversation(id: string) {
    if (busy || id === conversationId) return;
    const conversation = await loadConversation(id);
    if (!conversation || conversation.projectId !== projectId) {
      await initialize();
      return;
    }
    displayConversation(conversation);
    setNavigationOpen(false);
  }
  async function startNewConversation() {
    if (busy) return;
    try {
      const fresh = await createConversation(projectId);
      setActiveConversations((items) => [fresh, ...items]);
      displayConversation(fresh);
      setShowArchived(false);
      setNavigationOpen(false);
      window.setTimeout(() => composer.current?.focus(), 0);
    } catch {
      setInitError("A new conversation could not be started.");
    }
  }
  async function archiveCurrent() {
    if (!conversationId) return;
    try {
      await archiveConversation(conversationId);
      localStorage.removeItem(conversationKey);
      setMessages([]);
      setSelected(undefined);
      setSelectedCitationId(undefined);
      setContinuityNotice(undefined);
      setResetOpen(false);
      const remaining = await refreshConversationLists();
      const next = remaining[0]
        ? await loadConversation(remaining[0].id)
        : await createConversation(projectId);
      if (!next) throw new Error("Missing fallback conversation");
      if (!remaining.length) setActiveConversations([next]);
      displayConversation(next);
      window.setTimeout(() => composer.current?.focus(), 0);
    } catch {
      setInitError(
        "The conversation could not be archived. Your history is unchanged.",
      );
      setResetOpen(false);
    }
  }
  async function archiveOne(id: string) {
    if (id === conversationId) {
      setResetOpen(true);
      return;
    }
    if (busy) return;
    try {
      await archiveConversation(id);
      await refreshConversationLists();
    } catch {
      setInitError("The conversation could not be archived.");
    }
  }
  async function saveName(id: string, name: string) {
    if (busy) return;
    try {
      await renameConversation(id, name.trim());
      await refreshConversationLists();
    } catch {
      setInitError("The conversation could not be renamed.");
    }
  }
  async function restoreArchived(id: string) {
    if (busy) return;
    try {
      const restored = await restoreConversation(id);
      await refreshConversationLists();
      setShowArchived(false);
      displayConversation(restored);
    } catch {
      setInitError("The conversation could not be restored.");
    }
  }
  async function permanentlyDelete(id: string) {
    if (busy || !window.confirm("Permanently delete this conversation?"))
      return;
    try {
      await purgeConversation(id);
      await refreshConversationLists();
    } catch {
      setInitError("The conversation could not be permanently deleted.");
    }
  }
  async function loadMoreConversations(state: "active" | "archived") {
    if (busy) return;
    const cursor = state === "active" ? activeCursor : archivedCursor;
    if (!cursor) return;
    try {
      const page = await listConversations(projectId, state, cursor);
      if (state === "active") {
        setActiveConversations((items) => [...items, ...page.items]);
        setActiveCursor(page.nextCursor);
      } else {
        setArchivedConversations((items) => [...items, ...page.items]);
        setArchivedCursor(page.nextCursor);
      }
    } catch {
      setInitError("More conversations could not be loaded.");
    }
  }
  const closeNavigation = useCallback(() => {
    setNavigationOpen(false);
    window.setTimeout(() => navigationTrigger.current?.focus(), 0);
  }, []);
  const closeEvidence = useCallback(() => {
    pendingEvidenceFocus.current = {
      citationId: selectedCitationId,
      trigger: evidenceTrigger.current,
    };
    setSelected(undefined);
    setSelectedCitationId(undefined);
    setContextTab("files");
    evidenceTrigger.current = null;
  }, [selectedCitationId]);
  const openEvidence = useCallback(
    (message: UIMessage, trigger: HTMLElement, citationId?: string) => {
      evidenceTrigger.current = trigger;
      setSelectedCitationId(citationId);
      setSelected(message);
      setContextTab("sources");
      setContextOpen(true);
    },
    [],
  );
  const hasMessages = messages.length > 0;
  const latestAssistant = messages.findLast(
    (message) => message.role === "assistant" && Boolean(finalOf(message)),
  );
  const contextMessage = selected ?? latestAssistant;
  const currentConversation = activeConversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const setContextVisibility = useCallback(
    (open: boolean) => {
      setContextOpen(open);
      if (evidenceIsPanel) {
        localStorage.setItem(
          `graphify-context-panel-collapsed:${projectId}`,
          String(!open),
        );
      }
    },
    [evidenceIsPanel, projectId],
  );
  return (
    <div className="flex h-dvh max-w-full overflow-hidden">
      <aside
        aria-label="Primary navigation"
        className="hidden w-[clamp(13rem,16vw,18rem)] shrink-0 flex-col overflow-y-auto border-r bg-surface xl:flex"
      >
        <NavigationContent
          active={activeConversations}
          archived={archivedConversations}
          activeCursor={activeCursor}
          archivedCursor={archivedCursor}
          busy={busy}
          conversationId={conversationId}
          projectId={projectId}
          projectName={projectName}
          fileCount={files.length}
          projectState={project?.state}
          query={conversationQuery}
          showArchived={showArchived}
          onBack={onBack}
          create={() => void startNewConversation()}
          loadMore={(state) => void loadMoreConversations(state)}
          purge={(id) => void permanentlyDelete(id)}
          rename={(id, name) => void saveName(id, name)}
          restore={(id) => void restoreArchived(id)}
          archiveOne={(id) => void archiveOne(id)}
          select={(id) => void selectConversation(id)}
          setQuery={setConversationQuery}
          setShowArchived={setShowArchived}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b bg-surface/95 px-3 backdrop-blur sm:px-4">
          <div className="flex min-h-16 min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                ref={navigationTrigger}
                type="button"
                variant="outline"
                size="icon"
                aria-label="Open navigation"
                aria-expanded={navigationOpen}
                aria-controls="navigation-drawer"
                onClick={() => setNavigationOpen(true)}
                className="min-h-11 min-w-11 xl:hidden"
              >
                <Menu aria-hidden className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">
                  Graphify Knowledge Agent
                </h1>
                <p className="hidden truncate text-xs text-text-muted sm:block">
                  Evidence-grounded research workspace
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <ConnectionStatus status={connection} check={initialize} />
              <span className="hidden rounded-full border bg-background px-2.5 py-1 text-xs text-text-secondary lg:inline">
                Local
              </span>
              <span className="hidden max-w-32 truncate text-sm text-text-secondary 2xl:inline">
                {auth.username}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Log out"
                onClick={auth.logout}
              >
                <LogOut aria-hidden />
              </Button>
            </div>
          </div>
        </header>
        <header className="shrink-0 border-b bg-surface px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-text-muted">
                Project: {projectName ?? projectId}
              </p>
              <h1 className="mt-0.5 truncate text-base font-semibold">
                {currentConversation?.name ?? "New conversation"}
              </h1>
              {currentConversation && (
                <p className="mt-0.5 text-xs text-text-muted">
                  Updated {formatRelativeTime(currentConversation.updatedAt)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" disabled>
                    Share link
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sharing links are coming soon</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Conversation actions"
                    disabled={!conversationId || busy}
                  >
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                    <Pencil aria-hidden /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setResetOpen(true)}
                    className="text-error focus:text-error"
                  >
                    <Archive aria-hidden /> Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {(!evidenceIsPanel || !contextOpen) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Open project context"
                      onClick={() => setContextVisibility(true)}
                    >
                      <PanelRightOpen aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open project context</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <section
              aria-label="Conversation"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-5 sm:py-7"
            >
              <div className="mx-auto w-full max-w-[52rem]">
                {!hasMessages ? (
                  <EmptyState choose={setDraft} />
                ) : (
                  <div className="space-y-5">
                    {messages.map((message) => (
                      <Message
                        key={message.id}
                        message={message}
                        busy={busy && message === messages.at(-1)}
                        openEvidence={(trigger, citationId) =>
                          openEvidence(message, trigger, citationId)
                        }
                        retry={() =>
                          void (lastQuestion
                            ? submit(lastQuestion)
                            : regenerate())
                        }
                      />
                    ))}
                  </div>
                )}
                {(error || initError) && (
                  <div
                    role="alert"
                    className="mt-5 rounded-lg border border-error-border bg-error-surface p-4 text-sm text-error"
                  >
                    <CircleAlert className="mr-2 inline h-4 w-4" />
                    {initError ??
                      (error
                        ? readableChatError(error)
                        : "The request failed.")}
                  </div>
                )}
                {continuityNotice && (
                  <div
                    role="status"
                    className="mt-5 rounded-lg border border-information-border bg-information-surface p-4 text-sm text-information"
                  >
                    {continuityNotice}
                  </div>
                )}
              </div>
            </section>
            <div className="shrink-0 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-5">
              <form
                className="mx-auto w-full max-w-[52rem] rounded-lg border bg-surface p-3 shadow-panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <label htmlFor="question" className="text-sm font-semibold">
                  Ask a question
                </label>
                <Textarea
                  ref={composer}
                  id="question"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder="What does this knowledge graph say about…?"
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className="mt-2 w-full resize-none rounded-md border bg-background p-3 disabled:opacity-60"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="hidden text-xs text-text-muted sm:inline">
                    Enter to send · Shift+Enter for a new line
                  </span>
                  {busy ? (
                    <Button
                      type="button"
                      aria-label="Stop response"
                      onClick={stop}
                      className="ml-auto bg-foreground hover:bg-foreground/90"
                    >
                      <Square />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      aria-label="Send question"
                      disabled={
                        !draft.trim() ||
                        connection !== "connected" ||
                        !conversationId
                      }
                      className="ml-auto min-h-11"
                    >
                      <Send />
                      Send
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </main>
          {evidenceIsPanel && (
            <ProjectContextPanel
              mode="panel"
              open={contextOpen}
              onOpenChange={(open) => {
                setContextVisibility(open);
                if (!open && selected) closeEvidence();
              }}
              projectId={projectId}
              files={files}
              canUpload={project?.allowedActions.editDraft ?? false}
              tab={contextTab}
              setTab={(tab) => {
                setContextTab(tab);
                if (tab === "files") setSelectedCitationId(undefined);
              }}
              answer={contextMessage ? finalOf(contextMessage) : undefined}
              citations={contextMessage ? citationsOf(contextMessage) : []}
              selectedCitationId={selectedCitationId}
              onCollapse={() => setContextVisibility(false)}
            />
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {busy
            ? "Question submitted."
            : status === "ready" && hasMessages
              ? "Answer complete."
              : ""}
        </p>
      </div>
      {navigationOpen && (
        <Sheet open onOpenChange={(open) => !open && closeNavigation()}>
          <SheetContent
            id="navigation-drawer"
            side="left"
            aria-label="Primary navigation"
            className="w-[min(22rem,calc(100vw-2rem))] p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Primary navigation</SheetTitle>
              <SheetDescription>
                Project status and conversation controls
              </SheetDescription>
            </SheetHeader>
            <NavigationContent
              active={activeConversations}
              archived={archivedConversations}
              activeCursor={activeCursor}
              archivedCursor={archivedCursor}
              busy={busy}
              conversationId={conversationId}
              projectId={projectId}
              projectName={projectName}
              fileCount={files.length}
              projectState={project?.state}
              query={conversationQuery}
              showArchived={showArchived}
              onBack={onBack}
              create={() => void startNewConversation()}
              loadMore={(state) => void loadMoreConversations(state)}
              purge={(id) => void permanentlyDelete(id)}
              rename={(id, name) => void saveName(id, name)}
              restore={(id) => void restoreArchived(id)}
              archiveOne={(id) => void archiveOne(id)}
              select={(id) => void selectConversation(id)}
              setQuery={setConversationQuery}
              setShowArchived={setShowArchived}
            />
          </SheetContent>
        </Sheet>
      )}
      {!evidenceIsPanel && (
        <ProjectContextPanel
          mode="drawer"
          open={contextOpen}
          onOpenChange={(open) => {
            setContextVisibility(open);
            if (!open && selected) closeEvidence();
          }}
          projectId={projectId}
          files={files}
          canUpload={project?.allowedActions.editDraft ?? false}
          tab={contextTab}
          setTab={(tab) => {
            setContextTab(tab);
            if (tab === "files") setSelectedCitationId(undefined);
          }}
          answer={contextMessage ? finalOf(contextMessage) : undefined}
          citations={contextMessage ? citationsOf(contextMessage) : []}
          selectedCitationId={selectedCitationId}
          onCollapse={() => setContextVisibility(false)}
        />
      )}
      {resetOpen && (
        <ConfirmReset
          cancel={() => setResetOpen(false)}
          confirm={() => void archiveCurrent()}
        />
      )}
      {renameOpen && currentConversation && (
        <RenameConversationDialog
          conversation={currentConversation}
          cancel={() => setRenameOpen(false)}
          confirm={(name) => {
            void saveName(currentConversation.id, name).then(() =>
              setRenameOpen(false),
            );
          }}
        />
      )}
    </div>
  );
}

function NavigationContent({
  active,
  archived,
  activeCursor,
  archivedCursor,
  busy,
  conversationId,
  projectId,
  projectName,
  fileCount,
  projectState,
  query,
  showArchived,
  onBack,
  create,
  loadMore,
  purge,
  rename,
  restore,
  archiveOne,
  select,
  setQuery,
  setShowArchived,
}: {
  active: ConversationSummary[];
  archived: ConversationSummary[];
  activeCursor: string | null;
  archivedCursor: string | null;
  busy: boolean;
  conversationId?: string;
  projectId: string;
  projectName?: string;
  fileCount: number;
  projectState?: Project["state"];
  query: string;
  showArchived: boolean;
  onBack?: () => void;
  create: () => void;
  loadMore: (state: "active" | "archived") => void;
  purge: (id: string) => void;
  rename: (id: string, name: string) => void;
  restore: (id: string) => void;
  archiveOne: (id: string) => void;
  select: (id: string) => void;
  setQuery: (value: string) => void;
  setShowArchived: (value: boolean) => void;
}) {
  const conversations = (showArchived ? archived : active).filter(
    (conversation) =>
      !query.trim() ||
      conversation.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex min-h-full flex-col p-4">
      <Link
        href="/"
        onClick={
          onBack
            ? (event) => {
                event.preventDefault();
                onBack();
              }
            : undefined
        }
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text-secondary hover:bg-background"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> All projects
      </Link>
      <Link
        href={`/projects/${encodeURIComponent(projectId)}`}
        className="mt-1 break-words px-2 py-2 text-base font-semibold leading-5 hover:text-primary"
        title={projectName ?? projectId}
      >
        {projectName ?? projectId}
      </Link>
      <nav aria-label="Project" className="mt-2 border-t pt-3">
        <ProjectNavigationLink
          href={`/projects/${encodeURIComponent(projectId)}/chat`}
          label="Conversation"
          icon={MessageSquare}
          selected
        />
        <ProjectNavigationLink
          href={`/projects/${encodeURIComponent(projectId)}?section=documents`}
          label="Files"
          icon={FileText}
          suffix={fileCount.toString()}
          processing={projectState === "queued" || projectState === "building"}
        />
        <ProjectNavigationLink
          href={`/projects/${encodeURIComponent(projectId)}?section=builds`}
          label="Knowledge"
          icon={Network}
        />
        <ProjectNavigationLink
          href={`/projects/${encodeURIComponent(projectId)}?section=settings`}
          label="Project settings"
          icon={Settings}
        />
        <span
          aria-disabled="true"
          className="mt-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-text-muted opacity-60"
          title="Access and sharing is coming soon"
        >
          <Users aria-hidden className="h-5 w-5" /> Access &amp; sharing
        </span>
      </nav>
      <section
        aria-labelledby="conversations-heading"
        className="mt-4 min-h-0 border-t pt-4"
      >
        <h2
          id="conversations-heading"
          className="px-2 text-xs font-semibold text-text-muted"
        >
          Conversations
        </h2>
        <Button
          type="button"
          disabled={busy}
          onClick={create}
          className="mt-2 min-h-11 w-full justify-start"
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
            type="button"
            size="sm"
            variant={showArchived ? "outline" : "secondary"}
            onClick={() => setShowArchived(false)}
            disabled={busy}
          >
            Active
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showArchived ? "secondary" : "outline"}
            onClick={() => setShowArchived(true)}
            disabled={busy}
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
            <ConversationNavigationItem
              key={conversation.id}
              conversation={conversation}
              selected={!showArchived && conversation.id === conversationId}
              archived={showArchived}
              busy={busy}
              onSelect={() => select(conversation.id)}
              onRename={(name) => rename(conversation.id, name)}
              onRestore={() => restore(conversation.id)}
              onArchive={() => archiveOne(conversation.id)}
              onPurge={() => purge(conversation.id)}
            />
          ))}
        </ul>
        {conversations.length === 0 && (
          <p className="mt-3 text-sm text-text-muted">
            {query.trim()
              ? "No conversations match your search."
              : showArchived
                ? "No archived conversations."
                : "No active conversations."}
          </p>
        )}
        {(showArchived ? archivedCursor : activeCursor) && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => loadMore(showArchived ? "archived" : "active")}
            className="mt-3 min-h-11 w-full"
          >
            Load more
          </Button>
        )}
      </section>
    </div>
  );
}

function ProjectNavigationLink({
  href,
  label,
  icon: Icon,
  selected = false,
  suffix,
  processing = false,
}: {
  href: string;
  label: string;
  icon: typeof MessageSquare;
  selected?: boolean;
  suffix?: string;
  processing?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={`mt-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium ${
        selected
          ? "bg-selected text-primary"
          : "text-text-secondary hover:bg-background"
      }`}
    >
      <Icon aria-hidden className="h-5 w-5" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {processing ? (
        <LoaderCircle
          aria-label="Processing"
          className="h-4 w-4 animate-spin text-warning"
        />
      ) : suffix ? (
        <span className="text-xs text-text-muted">{suffix}</span>
      ) : null}
    </Link>
  );
}

function ConversationNavigationItem({
  conversation,
  selected,
  archived,
  busy,
  onSelect,
  onRename,
  onRestore,
  onArchive,
  onPurge,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  archived: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRestore: () => void;
  onArchive: () => void;
  onPurge: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(conversation.name);
  if (editing) {
    return (
      <li>
        <form
          className="rounded-lg border p-2"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (!normalized) return;
            onRename(normalized);
            setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`rename-${conversation.id}`}>
            Conversation name
          </label>
          <input
            id={`rename-${conversation.id}`}
            autoFocus
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 w-full rounded-md border px-2 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li
      className={`group flex min-w-0 items-center rounded-md px-1 ${selected ? "bg-selected" : "hover:bg-background"}`}
    >
      {!archived && (
        <button
          type="button"
          disabled={busy}
          aria-current={selected ? "page" : undefined}
          onClick={onSelect}
          className="min-h-11 min-w-0 flex-1 truncate px-2 text-left text-sm font-medium disabled:opacity-50"
        >
          <MessageSquare
            aria-hidden
            className="mr-2 inline h-4 w-4 text-text-muted"
          />
          <span>{conversation.name}</span>
        </button>
      )}
      {archived && (
        <p className="min-h-11 min-w-0 flex-1 truncate px-2 py-3 text-sm font-medium">
          <Archive
            aria-hidden
            className="mr-2 inline h-4 w-4 text-text-muted"
          />
          {conversation.name}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Actions for ${conversation.name}`}
            className="shrink-0"
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!archived ? (
            <>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil aria-hidden /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onArchive} className="text-error">
                <Archive aria-hidden /> Archive
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={onRestore}>
                <Undo2 aria-hidden /> Restore
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onPurge} className="text-error">
                <Trash2 aria-hidden /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function ConnectionStatus({
  status,
  check,
}: {
  status: Connection;
  check: () => Promise<void>;
}) {
  const label =
    status === "checking"
      ? "Checking API connection"
      : status === "connected"
        ? "API connected"
        : "API unavailable";
  return (
    <div
      aria-live="polite"
      className="flex min-h-11 items-center gap-2 text-sm text-text-secondary"
    >
      {status === "connected" ? (
        <CircleCheck aria-hidden className="h-4 w-4 text-success" />
      ) : status === "checking" ? (
        <LoaderCircle
          aria-hidden
          className="h-4 w-4 animate-spin text-warning"
        />
      ) : (
        <CircleAlert aria-hidden className="h-4 w-4 text-error" />
      )}
      <span className="sr-only sm:not-sr-only">{label}</span>
      {status === "unavailable" && (
        <Button
          variant="link"
          onClick={() => void check()}
          className="h-auto p-0"
        >
          Check connection
        </Button>
      )}
    </div>
  );
}
function EmptyState({ choose }: { choose: (value: string) => void }) {
  return (
    <div className="mx-auto mt-12 max-w-2xl rounded-lg border bg-surface p-7 text-center shadow-panel">
      <BookOpen className="mx-auto h-9 w-9 text-primary" />
      <h2 className="mt-4 text-xl font-semibold">
        Explore your connected knowledge
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-text-secondary">
        Ask a question and inspect the Graphify sources, relationships, and
        paths supporting the answer.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {[
          "What are the main concepts in this project?",
          "How are the key entities related?",
        ].map((q) => (
          <Button
            key={q}
            variant="outline"
            onClick={() => choose(q)}
            className="rounded-full bg-background hover:bg-selected"
          >
            {q}
          </Button>
        ))}
      </div>
    </div>
  );
}
function Message({
  message,
  busy,
  openEvidence,
  retry,
}: {
  message: UIMessage;
  busy: boolean;
  openEvidence: (trigger: HTMLElement, citationId?: string) => void;
  retry: () => void;
}) {
  const events = eventsOf(message),
    answer = finalOf(message),
    citations = citationsOf(message),
    text = answer?.answer ?? textOf(message);
  const failed = events.findLast((e) => e.kind === "failed");
  const searching =
    events.findLast((e) => e.kind === "activity")?.activity === "searching";
  const clarification = answer?.responseType === "clarification";
  return (
    <article
      aria-label={`${message.role === "user" ? "You" : "Graphify Agent"} message`}
      className={`rounded-lg border p-5 ${message.role === "user" ? "ml-auto max-w-2xl border-information-border bg-information-surface" : "bg-surface shadow-panel"}`}
    >
      <div className="mb-2 text-xs font-medium text-text-muted">
        {message.role === "user" ? "You" : "Graphify Agent"}
      </div>
      {message.role === "user" ? (
        <p className="whitespace-pre-wrap">{text}</p>
      ) : (
        <>
          {busy && (
            <div className="mb-3 flex items-center gap-2 text-sm text-information">
              <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              {searching
                ? "Searching the knowledge graph…"
                : "Preparing the grounded answer…"}
            </div>
          )}
          {answer?.responseType === "insufficient" && (
            <h3 className="mb-2 font-semibold text-warning">
              Not enough evidence in this project
            </h3>
          )}
          {text && (
            <div className="prose max-w-none">
              <CitedAnswer
                text={text}
                citations={citations}
                onCitation={(citationId, opener) =>
                  openEvidence(opener, citationId)
                }
              />
            </div>
          )}
          {answer && !clarification && (
            <GroundingCoverage answer={answer} citations={citations} />
          )}
          {answer?.warnings.map((w) => (
            <div
              key={w}
              className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning"
            >
              {w}
            </div>
          ))}
          {answer && answer.responseType === "answer" && !citations.length && (
            <div className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning">
              No supporting citations were returned. Treat this answer with
              caution.
            </div>
          )}
          {failed && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-error-border bg-error-surface p-3 text-sm text-error"
            >
              {failed.error.message}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {!clarification && (citations.length > 0 || answer) && (
              <Button
                aria-label="View sources"
                variant="outline"
                onClick={(event) => openEvidence(event.currentTarget)}
                className="min-h-11"
              >
                <Search />
                Sources ({citations.length})
              </Button>
            )}
            {failed && failed.error.retryable && (
              <Button
                aria-label="Retry answer"
                onClick={retry}
                className="min-h-11"
              >
                Retry answer
              </Button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function GroundingCoverage({
  answer,
  citations,
}: {
  answer: Answer;
  citations: Citation[];
}) {
  const directCount = citations.filter(
    (citation) => citation.provenance === "explicit",
  ).length;
  const graphCount =
    answer.graphEvidence.nodes.length + answer.graphEvidence.edges.length;
  const coverage =
    citations.length >= 2 && graphCount > 0
      ? "Strong"
      : citations.length > 0
        ? "Supported"
        : "Limited";
  const tone =
    coverage === "Strong" || coverage === "Supported"
      ? "border-success-border bg-success-surface text-success"
      : "border-warning-border bg-warning-surface text-warning";

  return (
    <div className={`mt-4 rounded-md border p-3 text-sm ${tone}`}>
      <p className="flex items-center gap-2 font-semibold">
        {citations.length ? (
          <CircleCheck aria-hidden className="h-4 w-4" />
        ) : (
          <CircleAlert aria-hidden className="h-4 w-4" />
        )}
        Evidence coverage: {coverage}
      </p>
      <p className="mt-1 text-xs">
        {directCount} direct {directCount === 1 ? "source" : "sources"} ·{" "}
        {citations.length} supporting{" "}
        {citations.length === 1 ? "passage" : "passages"}
        {graphCount > 0 ? " · Graph context available" : ""}
      </p>
    </div>
  );
}
function RenameConversationDialog({
  conversation,
  cancel,
  confirm,
}: {
  conversation: ConversationSummary;
  cancel: () => void;
  confirm: (name: string) => void;
}) {
  const [name, setName] = useState(conversation.name);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>
            Choose a concise name that will be easy to find later.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (normalized) confirm(normalized);
          }}
        >
          <label htmlFor="conversation-name" className="text-sm font-medium">
            Conversation name
          </label>
          <input
            ref={inputRef}
            id="conversation-name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
          />
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmReset({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent
        role="alertdialog"
        hideClose
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Archive conversation?</DialogTitle>
          <DialogDescription>
            Archive this conversation? You can restore it from the Archived
            view.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={cancel}
            className="min-h-11"
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} className="min-h-11">
            Archive conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatRelativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function parseChatError(error: Error): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(error.message) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      ("code" in parsed || "message" in parsed)
    ) {
      const value = parsed as { code?: unknown; message?: unknown };
      return {
        code: typeof value.code === "string" ? value.code : undefined,
        message: typeof value.message === "string" ? value.message : undefined,
      };
    }
  } catch {
    // Non-JSON errors are already suitable for display.
  }
  return { message: error.message };
}

function isExpiredConversationError(error: Error) {
  const parsed = parseChatError(error);
  return (
    parsed.code === "conversation_expired" ||
    parsed.message?.toLowerCase().includes("conversation expired") === true
  );
}

function readableChatError(error: Error) {
  const parsed = parseChatError(error);
  if (parsed.code === "conversation_busy") {
    return "This conversation is already processing a question. Wait for it to finish, then try again.";
  }
  return parsed.message || "The request failed.";
}
