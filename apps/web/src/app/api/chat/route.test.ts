import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

function chatRequest() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: "conv-1",
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "What about that law?" }],
        },
      ],
    }),
  });
}

describe("chat route upstream errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves an active-conversation conflict as a typed 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 409 })),
    );

    const response = await POST(chatRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "conversation_busy",
      message:
        "This conversation is already processing a question. Wait for it to finish, then try again.",
    });
  });

  it("identifies an expired conversation so the client can recover", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    const response = await POST(chatRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "conversation_expired",
      message: "This conversation expired.",
    });
  });
});
