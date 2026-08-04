"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowLeft,
  Archive,
  BookOpen,
  CircleAlert,
  LoaderCircle,
  Menu,
  Pencil,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  type UIEvent,
  uiEventSchema,
} from "@/lib/contracts";
import { CitedAnswer } from "./cited-answer";
import { EvidenceDrawer } from "./evidence-drawer";

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
  projectName,
  onBack,
}: {
  projectId?: string;
  projectName?: string;
  onBack?: () => void;
} = {}) {
  const [conversationId, setConversationId] = useState<string>();
  const [projectId, setProjectId] = useState(
    selectedProjectId ?? "sample-project",
  );
  const conversationKey = selectedProjectId
    ? `${CONVERSATION_KEY}:${selectedProjectId}`
    : CONVERSATION_KEY;
  const [connection, setConnection] = useState<Connection>("checking");
  const [draft, setDraft] = useState("");
  const [initError, setInitError] = useState<string>();
  const [continuityNotice, setContinuityNotice] = useState<string>();
  const [selected, setSelected] = useState<UIMessage>();
  const [selectedCitationId, setSelectedCitationId] = useState<string>();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [activeConversations, setActiveConversations] = useState<
    ConversationSummary[]
  >([]);
  const [archivedConversations, setArchivedConversations] = useState<
    ConversationSummary[]
  >([]);
  const [showArchived, setShowArchived] = useState(false);
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
  const evidenceIsPanel = useMediaQuery("(min-width: 768px)");
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
    evidenceTrigger.current = null;
  }, [selectedCitationId]);
  const openEvidence = useCallback(
    (message: UIMessage, trigger: HTMLElement, citationId?: string) => {
      evidenceTrigger.current = trigger;
      setSelectedCitationId(citationId);
      setSelected(message);
    },
    [],
  );
  const hasMessages = messages.length > 0;
  return (
    <div className="flex h-dvh max-w-full overflow-hidden">
      <aside
        aria-label="Primary navigation"
        className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-white xl:flex"
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
          showArchived={showArchived}
          onBack={onBack}
          archive={() => setResetOpen(true)}
          create={() => void startNewConversation()}
          loadMore={(state) => void loadMoreConversations(state)}
          purge={(id) => void permanentlyDelete(id)}
          rename={(id, name) => void saveName(id, name)}
          restore={(id) => void restoreArchived(id)}
          select={(id) => void selectConversation(id)}
          setShowArchived={setShowArchived}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b bg-white/90 px-3 py-3 backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
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
                <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">
                  Graphify Knowledge Agent
                </h1>
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  Answers grounded in connected knowledge
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <ConnectionStatus status={connection} check={initialize} />
            </div>
          </div>
        </header>
        <div className="shrink-0 border-b bg-sky-50 px-3 py-2 text-sm sm:px-4">
          <div className="min-w-0 truncate">
            <strong>Knowledge project:</strong>{" "}
            <span className="font-medium" title={projectName ?? projectId}>
              {projectName ?? projectId}
            </span>
            <span className="ml-2 hidden text-slate-600 lg:inline">
              Answers use this knowledge graph.
            </span>
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <section
              aria-label="Conversation"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-5 sm:py-7"
            >
              <div className="mx-auto w-full max-w-4xl">
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
                    className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
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
                    className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"
                  >
                    {continuityNotice}
                  </div>
                )}
              </div>
            </section>
            <div className="shrink-0 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-5">
              <form
                className="mx-auto w-full max-w-4xl rounded-2xl border bg-white p-3 shadow-xl"
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
                  className="mt-2 w-full resize-none rounded-lg border bg-slate-50 p-3 disabled:opacity-60"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="hidden text-xs text-slate-500 sm:inline">
                    Enter to send · Shift+Enter for a new line
                  </span>
                  {busy ? (
                    <Button
                      type="button"
                      aria-label="Stop response"
                      onClick={stop}
                      className="ml-auto min-h-11 bg-slate-900 hover:bg-slate-800"
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
          {selected && evidenceIsPanel && (
            <EvidenceDrawer
              mode="panel"
              answer={finalOf(selected)}
              citations={citationsOf(selected)}
              selectedCitationId={selectedCitationId}
              onClose={closeEvidence}
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
              showArchived={showArchived}
              onBack={onBack}
              archive={() => {
                setNavigationOpen(false);
                setResetOpen(true);
              }}
              create={() => void startNewConversation()}
              loadMore={(state) => void loadMoreConversations(state)}
              purge={(id) => void permanentlyDelete(id)}
              rename={(id, name) => void saveName(id, name)}
              restore={(id) => void restoreArchived(id)}
              select={(id) => void selectConversation(id)}
              setShowArchived={setShowArchived}
            />
          </SheetContent>
        </Sheet>
      )}
      {selected && !evidenceIsPanel && (
        <EvidenceDrawer
          mode="drawer"
          answer={finalOf(selected)}
          citations={citationsOf(selected)}
          selectedCitationId={selectedCitationId}
          onClose={closeEvidence}
        />
      )}
      {resetOpen && (
        <ConfirmReset
          cancel={() => setResetOpen(false)}
          confirm={() => void archiveCurrent()}
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
  showArchived,
  onBack,
  archive,
  create,
  loadMore,
  purge,
  rename,
  restore,
  select,
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
  showArchived: boolean;
  onBack?: () => void;
  archive: () => void;
  create: () => void;
  loadMore: (state: "active" | "archived") => void;
  purge: (id: string) => void;
  rename: (id: string, name: string) => void;
  restore: (id: string) => void;
  select: (id: string) => void;
  setShowArchived: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-full flex-col gap-5 p-5">
      {onBack && (
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="min-h-11 w-full justify-start"
        >
          <ArrowLeft aria-hidden />
          Projects
        </Button>
      )}
      <div>
        <p className="text-lg font-bold">Graphify</p>
        <p className="text-sm text-slate-600">Knowledge workspace</p>
      </div>
      <nav aria-label="Workspace" className="min-h-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Current project
        </p>
        <p
          className="mt-2 break-words rounded-lg bg-slate-50 p-3 text-sm font-semibold leading-5 text-slate-900"
          title={projectName ?? projectId}
        >
          {projectName ?? projectId}
        </p>
        <Button
          type="button"
          disabled={busy}
          onClick={create}
          className="mt-3 min-h-11 w-full justify-start"
        >
          <Plus aria-hidden /> New conversation
        </Button>
        <div
          className="mt-4 flex gap-2"
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
          className="mt-3 space-y-2"
          aria-label={
            showArchived ? "Archived conversations" : "Active conversations"
          }
        >
          {(showArchived ? archived : active).map((conversation) => (
            <ConversationNavigationItem
              key={conversation.id}
              conversation={conversation}
              selected={!showArchived && conversation.id === conversationId}
              archived={showArchived}
              busy={busy}
              onSelect={() => select(conversation.id)}
              onRename={(name) => rename(conversation.id, name)}
              onRestore={() => restore(conversation.id)}
              onPurge={() => purge(conversation.id)}
            />
          ))}
        </ul>
        {(showArchived ? archived : active).length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            {showArchived
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
      </nav>
      <div className="mt-auto space-y-3">
        <Button
          aria-label="Archive conversation"
          variant="outline"
          disabled={!conversationId || busy}
          onClick={archive}
          className="min-h-11 w-full justify-start"
        >
          <Archive aria-hidden />
          Archive conversation
        </Button>
      </div>
    </div>
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
  onPurge,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  archived: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRestore: () => void;
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
      className={`rounded-lg border p-2 ${selected ? "border-sky-500 bg-sky-50" : "bg-white"}`}
    >
      {!archived && (
        <button
          type="button"
          disabled={busy}
          aria-current={selected ? "page" : undefined}
          onClick={onSelect}
          className="min-h-11 w-full break-words text-left text-sm font-medium disabled:opacity-50"
        >
          {conversation.name}
        </button>
      )}
      {archived && (
        <p className="break-words px-1 py-2 text-sm font-medium">
          {conversation.name}
        </p>
      )}
      <div className="flex gap-1">
        {!archived && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={`Rename ${conversation.name}`}
            onClick={() => setEditing(true)}
            className="min-h-11 min-w-11"
          >
            <Pencil aria-hidden />
          </Button>
        )}
        {archived && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={`Restore ${conversation.name}`}
              onClick={onRestore}
              className="min-h-11 min-w-11"
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={`Permanently delete ${conversation.name}`}
              onClick={onPurge}
              className="min-h-11 min-w-11 text-red-700"
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
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
      className="flex min-h-11 items-center gap-2 text-sm"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "checking" ? "bg-amber-500" : "bg-red-500"}`}
      />
      <span>{label}</span>
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
    <div className="mx-auto mt-12 max-w-2xl rounded-2xl border bg-white p-7 text-center shadow-sm">
      <BookOpen className="mx-auto h-9 w-9 text-sky-600" />
      <h2 className="mt-4 text-2xl font-bold">
        Explore your connected knowledge
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-slate-600">
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
            className="min-h-11 rounded-full bg-slate-50 hover:bg-sky-50"
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
      className={`rounded-2xl border p-5 ${message.role === "user" ? "ml-auto max-w-2xl bg-sky-50" : "bg-white shadow-sm"}`}
    >
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        {message.role === "user" ? "You" : "Graphify Agent"}
      </div>
      {message.role === "user" ? (
        <p className="whitespace-pre-wrap">{text}</p>
      ) : (
        <>
          {busy && (
            <div className="mb-3 flex items-center gap-2 text-sm text-sky-800">
              <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              {searching
                ? "Searching Graphify"
                : "Writing an evidence-grounded answer"}
            </div>
          )}
          {answer?.responseType === "insufficient" && (
            <h3 className="mb-2 font-bold text-amber-900">
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
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Confidence: {answer.confidence}</Badge>
              {answer.graphVersion && (
                <Badge variant="secondary">
                  Graph version: {answer.graphVersion}
                </Badge>
              )}
            </div>
          )}
          {answer?.warnings.map((w) => (
            <div
              key={w}
              className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm"
            >
              {w}
            </div>
          ))}
          {answer && answer.responseType === "answer" && !citations.length && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              No supporting citations were returned. Treat this answer with
              caution.
            </div>
          )}
          {failed && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
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
            {answer &&
              !clarification &&
              answer.graphEvidence.nodes.length +
                answer.graphEvidence.edges.length +
                answer.graphEvidence.paths.length >
                0 && (
                <Button
                  aria-label="View evidence"
                  variant="outline"
                  onClick={(event) => openEvidence(event.currentTarget)}
                  className="min-h-11"
                >
                  View evidence
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
