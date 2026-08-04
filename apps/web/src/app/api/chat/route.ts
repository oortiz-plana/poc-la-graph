import { createParser, type EventSourceMessage } from "eventsource-parser";
import { streamEventSchema } from "@/lib/contracts";

export const runtime = "nodejs";
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://api:8000";

function frame(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId?: string;
    messages?: Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
      content?: string;
    }>;
  };
  const last = [...(body.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  const question =
    last?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("") ??
    last?.content ??
    "";
  if (!body.conversationId || !question.trim()) {
    return Response.json(
      { message: "A conversation and question are required." },
      { status: 400 },
    );
  }
  const upstream = await fetch(
    `${API_URL}/api/v1/conversations/${encodeURIComponent(body.conversationId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(request.headers.get("authorization")
          ? { Authorization: request.headers.get("authorization")! }
          : {}),
      },
      body: JSON.stringify({ message: question, includeGraphPaths: true }),
      signal: request.signal,
    },
  );
  if (!upstream.ok || !upstream.body) {
    const problem =
      upstream.status === 404
        ? {
            code: "conversation_expired",
            message: "This conversation expired.",
          }
        : upstream.status === 409
          ? {
              code: "conversation_busy",
              message:
                "This conversation is already processing a question. Wait for it to finish, then try again.",
            }
          : {
              code: "answer_service_unavailable",
              message: "The answer service is unavailable.",
            };
    return Response.json(problem, { status: upstream.status });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let textOpen = false;
      const push = (chunk: unknown) =>
        controller.enqueue(encoder.encode(frame(chunk)));
      const parser = createParser({
        onEvent(event: EventSourceMessage) {
          try {
            const parsed = streamEventSchema.parse(JSON.parse(event.data));
            if (parsed.type === "message.started") {
              push({ type: "start", messageId: parsed.messageId });
              push({
                type: "data-status",
                id: "status",
                data: { kind: "activity", activity: "searching" },
              });
            } else if (parsed.type === "tool.started") {
              push({
                type: "data-status",
                id: "status",
                data: { kind: "activity", activity: "searching" },
              });
            } else if (parsed.type === "tool.completed") {
              push({
                type: "data-status",
                id: "status",
                data: { kind: "activity", activity: "writing" },
              });
            } else if (parsed.type === "answer.delta") {
              if (!textOpen) {
                push({ type: "text-start", id: "answer" });
                textOpen = true;
              }
              push({ type: "text-delta", id: "answer", delta: parsed.delta });
            } else if (parsed.type === "citation.available") {
              push({
                type: "data-citation",
                data: { kind: "citation", citation: parsed.citation },
              });
            } else if (parsed.type === "message.completed") {
              if (textOpen) push({ type: "text-end", id: "answer" });
              push({
                type: "data-result",
                data: { kind: "completed", result: parsed.result },
              });
              push({ type: "finish", finishReason: "stop" });
            } else if (parsed.type === "message.failed") {
              push({
                type: "data-error",
                data: { kind: "failed", error: parsed.error },
              });
              push({ type: "error", errorText: parsed.error.message });
            }
          } catch {
            push({
              type: "error",
              errorText: "The response stream could not be validated.",
            });
          }
        },
      });
      try {
        const reader = upstream.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        push({
          type: "error",
          errorText:
            "The connection was interrupted before the answer completed.",
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
