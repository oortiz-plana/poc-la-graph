"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BookOpen,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Search,
  Send,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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
  checkHealth,
  createConversation,
  deleteConversation,
  getRuntimeConfig,
  loadConversation,
} from "@/lib/api";
import {
  type Answer,
  type Citation,
  type UIEvent,
  uiEventSchema,
} from "@/lib/contracts";
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

export function ChatWorkspace() {
  const [conversationId, setConversationId] = useState<string>();
  const [projectId, setProjectId] = useState("sample-project");
  const [connection, setConnection] = useState<Connection>("checking");
  const [draft, setDraft] = useState("");
  const [initError, setInitError] = useState<string>();
  const [continuityNotice, setContinuityNotice] = useState<string>();
  const [selected, setSelected] = useState<UIMessage>();
  const [resetOpen, setResetOpen] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { conversationId },
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

  const initialize = useCallback(async () => {
    setConnection("checking");
    setInitError(undefined);
    if (!(await checkHealth())) {
      setConnection("unavailable");
      return;
    }
    try {
      const config = await getRuntimeConfig();
      setProjectId(config.projectId);
      const stored = localStorage.getItem(CONVERSATION_KEY);
      let conversation = stored ? await loadConversation(stored) : null;
      if (!conversation || conversation.projectId !== config.projectId) {
        conversation = await createConversation(config.projectId);
        if (stored) {
          setContinuityNotice(
            "Your previous conversation expired, so a new conversation was started.",
          );
        }
      }
      localStorage.setItem(CONVERSATION_KEY, conversation.id);
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
      setConnection("connected");
    } catch {
      setConnection("unavailable");
      setInitError(
        "The API is reachable, but a conversation could not be started.",
      );
    }
  }, [setMessages]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (connection !== "unavailable") return;
    const timer = window.setInterval(() => void initialize(), 15_000);
    return () => window.clearInterval(timer);
  }, [connection, initialize]);
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
        localStorage.setItem(CONVERSATION_KEY, fresh.id);
        setConversationId(fresh.id);
        setMessages([]);
        setSelected(undefined);
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
  }, [clearError, error, lastQuestion, projectId, setMessages]);

  async function submit(question = draft) {
    const value = question.trim();
    if (!value || busy || connection !== "connected" || !conversationId) return;
    setLastQuestion(value);
    setDraft("");
    await sendMessage({ text: value }, { body: { conversationId } });
  }
  async function reset() {
    if (!conversationId) return;
    try {
      await deleteConversation(conversationId);
      localStorage.removeItem(CONVERSATION_KEY);
      setMessages([]);
      setSelected(undefined);
      setContinuityNotice(undefined);
      setResetOpen(false);
      const fresh = await createConversation(projectId);
      localStorage.setItem(CONVERSATION_KEY, fresh.id);
      setConversationId(fresh.id);
      window.setTimeout(() => composer.current?.focus(), 0);
    } catch {
      setInitError(
        "The conversation could not be reset. Your history is unchanged.",
      );
      setResetOpen(false);
    }
  }
  const hasMessages = messages.length > 0;
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white/90 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Graphify Knowledge Agent
            </h1>
            <p className="text-xs text-slate-500">
              Answers grounded in connected knowledge
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus status={connection} check={initialize} />
            <Button
              aria-label="Reset conversation"
              variant="outline"
              disabled={!hasMessages || busy}
              onClick={() => setResetOpen(true)}
              className="min-h-11"
            >
              <RotateCcw />
              Reset conversation
            </Button>
          </div>
        </div>
      </header>
      <div className="border-b bg-sky-50 px-4 py-2 text-sm">
        <div className="mx-auto max-w-6xl">
          <strong>Knowledge project:</strong>{" "}
          <span className="font-mono">{projectId}</span>
          <span className="ml-2 text-slate-600">
            Answers use this knowledge graph.
          </span>
        </div>
      </div>
      <main className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col px-4">
        <section aria-label="Conversation" className="flex-1 py-7">
          {!hasMessages ? (
            <EmptyState choose={setDraft} />
          ) : (
            <div className="space-y-5">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  busy={busy && message === messages.at(-1)}
                  openEvidence={() => setSelected(message)}
                  retry={() =>
                    void (lastQuestion ? submit(lastQuestion) : regenerate())
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
                (error ? readableChatError(error) : "The request failed.")}
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
        </section>
        <form
          className="sticky bottom-0 mb-4 rounded-2xl border bg-white p-3 shadow-xl"
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
            <span className="text-xs text-slate-500">
              Enter to send · Shift+Enter for a new line
            </span>
            {busy ? (
              <Button
                type="button"
                aria-label="Stop response"
                onClick={stop}
                className="min-h-11 bg-slate-900 hover:bg-slate-800"
              >
                <Square />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                aria-label="Send question"
                disabled={
                  !draft.trim() || connection !== "connected" || !conversationId
                }
                className="min-h-11"
              >
                <Send />
                Send
              </Button>
            )}
          </div>
        </form>
      </main>
      <p aria-live="polite" className="sr-only">
        {busy
          ? "Question submitted."
          : status === "ready" && hasMessages
            ? "Answer complete."
            : ""}
      </p>
      {selected && (
        <EvidenceDrawer
          answer={finalOf(selected)}
          citations={citationsOf(selected)}
          onClose={() => setSelected(undefined)}
        />
      )}
      {resetOpen && (
        <ConfirmReset
          cancel={() => setResetOpen(false)}
          confirm={() => void reset()}
        />
      )}
    </div>
  );
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
  openEvidence: () => void;
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
              <ReactMarkdown skipHtml>{text}</ReactMarkdown>
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
                onClick={openEvidence}
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
                  onClick={openEvidence}
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
          <DialogTitle>Reset conversation?</DialogTitle>
          <DialogDescription>
            Reset this conversation? This cannot be restored.
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
            Reset conversation
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
