import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { Answer } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
  regenerate: vi.fn(),
  setMessages: vi.fn(),
  checkHealth: vi.fn(),
  getRuntimeConfig: vi.fn(),
  createConversation: vi.fn(),
  loadConversation: vi.fn(),
  listConversations: vi.fn(),
  archiveConversation: vi.fn(),
  renameConversation: vi.fn(),
  restoreConversation: vi.fn(),
  purgeConversation: vi.fn(),
  chat: {
    messages: [] as UIMessage[],
    status: "ready",
    error: undefined as Error | undefined,
  },
  clearError: vi.fn(),
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(options: unknown) {
      void options;
    }
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    ...mocks.chat,
    sendMessage: mocks.sendMessage,
    stop: mocks.stop,
    regenerate: mocks.regenerate,
    setMessages: mocks.setMessages,
    clearError: mocks.clearError,
  }),
}));
vi.mock("@/lib/api", () => ({
  checkHealth: mocks.checkHealth,
  getRuntimeConfig: mocks.getRuntimeConfig,
  createConversation: mocks.createConversation,
  loadConversation: mocks.loadConversation,
  listConversations: mocks.listConversations,
  archiveConversation: mocks.archiveConversation,
  renameConversation: mocks.renameConversation,
  restoreConversation: mocks.restoreConversation,
  purgeConversation: mocks.purgeConversation,
}));

import { ChatWorkspace } from "./chat-workspace";

const conversation = {
  id: "conv-1",
  projectId: "sample-project",
  name: "New conversation",
  createdAt: "2026-07-28T00:00:00Z",
  updatedAt: "2026-07-28T00:00:00Z",
  archivedAt: null,
  messages: [],
};
const answer: Answer = {
  requestId: "req-1",
  conversationId: "conv-1",
  answer: "**Grounded** answer.",
  status: "completed",
  responseType: "answer",
  confidence: "high",
  graphVersion: "v1",
  citations: [
    {
      id: "c1",
      title: "Design doc",
      source: "sample.md",
      nodeId: "n1",
      relationship: null,
      provenance: "explicit",
      excerpt: "Grounded fact.",
    },
  ],
  graphEvidence: {
    nodes: [
      { id: "n1", label: "Fact", type: "Concept", provenance: "explicit" },
    ],
    edges: [],
    paths: [],
  },
  warnings: [],
};
const assistant = (events: unknown[], text = ""): UIMessage => ({
  id: "a1",
  role: "assistant",
  parts: [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...events.map((data, index) => ({
      type: `data-event-${index}` as `data-${string}`,
      data,
    })),
  ],
});

describe("ChatWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.messages = [];
    mocks.chat.status = "ready";
    mocks.chat.error = undefined;
    mocks.checkHealth.mockResolvedValue(true);
    mocks.getRuntimeConfig.mockResolvedValue({ projectId: "sample-project" });
    mocks.createConversation.mockResolvedValue(conversation);
    mocks.loadConversation.mockResolvedValue(null);
    mocks.listConversations.mockResolvedValue({ items: [], nextCursor: null });
    mocks.archiveConversation.mockResolvedValue(undefined);
    mocks.renameConversation.mockResolvedValue(conversation);
    mocks.restoreConversation.mockResolvedValue(conversation);
    mocks.purgeConversation.mockResolvedValue(undefined);
    window.matchMedia = vi
      .fn()
      .mockImplementation((query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }));
  });

  it("shows the project name instead of its opaque identifier", async () => {
    const projectId = "5ab3495a-51f0-43b8-a8af-d499cc9a5ba2";

    render(
      <ChatWorkspace projectId={projectId} projectName="Legal knowledge" />,
    );

    await screen.findByText("API connected");
    expect(screen.getAllByText("Legal knowledge")).toHaveLength(2);
    expect(screen.queryByText(projectId)).not.toBeInTheDocument();
  });

  it("persists the active conversation and submits with Enter", async () => {
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    expect(
      screen.getByText("Explore your connected knowledge"),
    ).toBeInTheDocument();

    const composer = screen.getByLabelText("Ask a question");
    await user.type(composer, "How are they related?{Enter}");
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: "How are they related?" },
      { body: { conversationId: "conv-1" } },
    );
    expect(composer).toHaveValue("");
    expect(localStorage.getItem("graphify-conversation-id")).toBe("conv-1");
  });

  it("resumes the most recently updated server conversation", async () => {
    localStorage.setItem("graphify-conversation-id", "saved-conversation");
    mocks.listConversations.mockImplementation(
      (_projectId: string, state: "active" | "archived") =>
        Promise.resolve({
          items:
            state === "active"
              ? [{ ...conversation, id: "saved-conversation" }]
              : [],
          nextCursor: null,
        }),
    );
    mocks.loadConversation.mockResolvedValue({
      ...conversation,
      id: "saved-conversation",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "What changed?",
          status: "completed",
          createdAt: "2026-07-28T00:00:00Z",
        },
      ],
    });

    render(<ChatWorkspace />);

    await screen.findByText("API connected");
    expect(mocks.loadConversation).toHaveBeenCalledWith("saved-conversation");
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "u1", role: "user" }),
      ]),
    );
  });

  it("recovers from a stale local selection using the server list", async () => {
    localStorage.setItem("graphify-conversation-id", "expired-conversation");
    mocks.loadConversation.mockResolvedValue(null);

    render(<ChatWorkspace />);

    await screen.findByText("API connected");
    expect(mocks.loadConversation).not.toHaveBeenCalledWith(
      "expired-conversation",
    );
    expect(localStorage.getItem("graphify-conversation-id")).toBe("conv-1");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your previous selection is no longer active",
    );
  });

  it("keeps server ordering and supports inline rename", async () => {
    const newest = { ...conversation, id: "newest", name: "Newest" };
    const older = { ...conversation, id: "older", name: "Older" };
    mocks.listConversations.mockImplementation(
      (_projectId: string, state: "active" | "archived") =>
        Promise.resolve({
          items: state === "active" ? [newest, older] : [],
          nextCursor: null,
        }),
    );
    mocks.loadConversation.mockResolvedValue(newest);
    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    expect(mocks.loadConversation).toHaveBeenCalledWith("newest");
    const list = screen.getAllByRole("list", {
      name: "Active conversations",
    })[0];
    expect(
      within(list).getAllByRole("button", { name: /Newest|Older/ })[0],
    ).toHaveTextContent("Newest");
    await userEvent.click(
      within(list).getByRole("button", { name: "Rename Newest" }),
    );
    const input = within(list).getByLabelText("Conversation name");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed conversation");
    await userEvent.click(within(list).getByRole("button", { name: "Save" }));
    expect(mocks.renameConversation).toHaveBeenCalledWith(
      "newest",
      "Renamed conversation",
    );
  });

  it("restores and permanently deletes conversations from Archived", async () => {
    const archived = {
      ...conversation,
      id: "archived",
      name: "Archived research",
      archivedAt: "2026-08-04T00:00:00Z",
    };
    mocks.listConversations.mockImplementation(
      (_projectId: string, state: "active" | "archived") =>
        Promise.resolve({
          items: state === "active" ? [conversation] : [archived],
          nextCursor: null,
        }),
    );
    mocks.loadConversation.mockResolvedValue(conversation);
    mocks.restoreConversation.mockResolvedValue({
      ...archived,
      archivedAt: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    await userEvent.click(
      screen.getAllByRole("button", { name: /Archived \(1\)/ })[0],
    );
    let archivedList = screen.getAllByRole("list", {
      name: "Archived conversations",
    })[0];
    await userEvent.click(
      within(archivedList).getByRole("button", {
        name: "Restore Archived research",
      }),
    );
    expect(mocks.restoreConversation).toHaveBeenCalledWith("archived");

    await userEvent.click(
      screen.getAllByRole("button", { name: /Archived \(1\)/ })[0],
    );
    archivedList = screen.getAllByRole("list", {
      name: "Archived conversations",
    })[0];
    await userEvent.click(
      within(archivedList).getByRole("button", {
        name: "Permanently delete Archived research",
      }),
    );
    expect(mocks.purgeConversation).toHaveBeenCalledWith("archived");
  });

  it("keeps Shift+Enter as a newline and exposes accessible controls", async () => {
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    const composer = screen.getByLabelText("Ask a question");
    await user.type(composer, "line one{Shift>}{Enter}{/Shift}line two");
    expect(composer).toHaveValue("line one\nline two");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send question" })).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Conversation" }),
    ).toBeInTheDocument();
  });

  it("opens overlay navigation, closes it with Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Primary navigation" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Primary navigation" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("renders streaming Graphify activity, markdown, citations, and evidence", async () => {
    mocks.chat.status = "streaming";
    mocks.chat.messages = [
      assistant([
        { kind: "activity", activity: "searching" },
        { kind: "citation", citation: answer.citations[0] },
        { kind: "completed", result: answer },
      ]),
    ];
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    expect(screen.getByText("Searching Graphify")).toBeInTheDocument();
    expect(screen.getByText("Grounded")).toHaveProperty("tagName", "STRONG");
    expect(screen.getByText("Confidence: high")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop response" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View sources" }));
    expect(
      screen.getByRole("dialog", { name: "Answer evidence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("[1] Design doc")).toBeInTheDocument();
    expect(screen.getByText("Nodes (1)")).toBeInTheDocument();
  });

  it("uses an in-layout evidence panel at tablet widths and returns focus to an inline citation", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia = vi
      .fn()
      .mockImplementation((query: string): MediaQueryList => ({
        matches: query === "(min-width: 768px)",
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }));
    mocks.chat.messages = [
      assistant([
        {
          kind: "completed",
          result: { ...answer, answer: "Grounded by c1." },
        },
      ]),
    ];
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    const citation = screen.getByRole("button", {
      name: /Open source 1:/,
    });
    await user.click(citation);

    expect(
      await screen.findByRole("complementary", { name: "Answer evidence" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close evidence" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Open source 1:/ }),
      ).toHaveFocus(),
    );
  });

  it("renders partial answer deltas before the completed event arrives", async () => {
    mocks.chat.status = "streaming";
    mocks.chat.messages = [
      assistant(
        [{ kind: "activity", activity: "writing" }],
        "A partial grounded answer",
      ),
    ];

    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    expect(screen.getByText("A partial grounded answer")).toBeInTheDocument();
    expect(
      screen.getByText("Writing an evidence-grounded answer"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View sources" }),
    ).not.toBeInTheDocument();
  });

  it("shows insufficient evidence, retryable failures, and retries", async () => {
    mocks.chat.messages = [
      assistant([
        {
          kind: "completed",
          result: {
            ...answer,
            answer: "No supporting facts found.",
            responseType: "insufficient",
            confidence: "insufficient",
            citations: [],
            graphEvidence: { nodes: [], edges: [], paths: [] },
          },
        },
        {
          kind: "failed",
          error: {
            code: "GRAPHIFY_UNAVAILABLE",
            message: "Graphify is unavailable.",
            retryable: true,
          },
        },
      ]),
    ];
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    expect(
      screen.getByText("Not enough evidence in this project"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Graphify is unavailable.",
    );
    await user.click(screen.getByRole("button", { name: "Retry answer" }));
    expect(mocks.regenerate).toHaveBeenCalledOnce();
  });

  it("renders a clarification naturally without evidence controls", async () => {
    mocks.chat.messages = [
      assistant([
        {
          kind: "completed",
          result: {
            ...answer,
            answer: "Which law are you asking about?",
            responseType: "clarification",
            confidence: "insufficient",
            graphVersion: null,
            citations: [],
            graphEvidence: { nodes: [], edges: [], paths: [] },
          },
        },
      ]),
    ];

    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    expect(
      screen.getByText("Which law are you asking about?"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Not enough evidence in this project"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View sources" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View evidence" }),
    ).not.toBeInTheDocument();
  });

  it("explains a concurrent-request conflict without resetting history", async () => {
    mocks.chat.error = new Error(
      JSON.stringify({
        code: "conversation_busy",
        message: "upstream detail",
      }),
    );

    render(<ChatWorkspace />);
    await screen.findByText("API connected");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This conversation is already processing a question",
    );
    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
  });

  it("reports connection errors and allows an explicit health retry", async () => {
    mocks.checkHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ChatWorkspace />);
    expect(await screen.findByText("API unavailable")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Check connection" }),
    );
    expect(await screen.findByText("API connected")).toBeInTheDocument();
    expect(mocks.checkHealth).toHaveBeenCalledTimes(2);
  });

  it("confirms archive, selects a fallback conversation, and focuses composer", async () => {
    mocks.chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ];
    mocks.createConversation
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({ ...conversation, id: "conv-2" });
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    await userEvent.click(
      screen.getByRole("button", { name: "Archive conversation" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Archive conversation?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Archive conversation" }).at(-1)!,
    );
    await waitFor(() =>
      expect(mocks.archiveConversation).toHaveBeenCalledWith("conv-1"),
    );
    expect(mocks.setMessages).toHaveBeenCalledWith([]);
    expect(localStorage.getItem("graphify-conversation-id")).toBe("conv-2");
    await waitFor(() =>
      expect(screen.getByLabelText("Ask a question")).toHaveFocus(),
    );
  });

  it("surfaces hook stream errors in an alert", async () => {
    mocks.chat.error = new Error("The stream was interrupted.");
    render(<ChatWorkspace />);
    await screen.findByText("API connected");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The stream was interrupted.",
    );
  });
});
