import { z } from "zod";

import { conversationSchema, type Conversation } from "./contracts";

const runtimeConfigSchema = z.object({
  projectId: z.string().min(1),
});

async function safeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    return (await safeFetch("/api/backend/health", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}
export async function getRuntimeConfig(): Promise<{ projectId: string }> {
  const response = await safeFetch("/api/config", { cache: "no-store" });
  if (!response.ok)
    throw new Error("Could not load the application configuration.");
  return runtimeConfigSchema.parse(await response.json());
}
export async function createConversation(
  projectId: string,
): Promise<Conversation> {
  const response = await safeFetch("/api/backend/api/v1/conversations", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) throw new Error("Could not start a conversation.");
  return conversationSchema.parse(await response.json());
}
export async function loadConversation(
  id: string,
): Promise<Conversation | null> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not restore the conversation.");
  return conversationSchema.parse(await response.json());
}
export async function deleteConversation(id: string): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404)
    throw new Error("Could not reset the conversation.");
}
