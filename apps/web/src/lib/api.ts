import { z } from "zod";
import { authorizationHeaders } from "./auth-token";

import {
  buildSummarySchema,
  conversationSchema,
  projectSchema,
  snapshotFileSchema,
  uploadSessionSchema,
  type BuildSummary,
  type Conversation,
  type Project,
  type SnapshotFile,
} from "./contracts";

const runtimeConfigSchema = z.object({
  keycloak: z.object({
    url: z.string().url(),
    realm: z.string().min(1),
    clientId: z.string().min(1),
  }),
  uploadLimits: z.object({
    maxFileBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive(),
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
type UploadLimits = RuntimeConfig["uploadLimits"];

const supportedUploadExtension = /\.(?:md|txt|html?|pdf|docx)$/i;
const unsafeFilenameCharacter = /[\\/\p{Cc}\p{Cf}\p{Cs}]/u;

export function validateUploadSelection(
  files: File[],
  limits: UploadLimits,
): string | undefined {
  if (!files.length) return "Choose at least one file.";
  if (files.length > limits.maxFiles)
    return `Select no more than ${limits.maxFiles} files.`;
  const names = new Set<string>();
  for (const file of files) {
    if (
      !file.name ||
      file.name === "." ||
      file.name === ".." ||
      file.name !== file.name.trim() ||
      file.name !== file.name.normalize("NFC") ||
      new TextEncoder().encode(file.name).length > 255 ||
      unsafeFilenameCharacter.test(file.name)
    ) {
      return `“${file.name || "Unnamed file"}” has an invalid filename.`;
    }
    if (!supportedUploadExtension.test(file.name))
      return `“${file.name}” is not a supported document format.`;
    if (names.has(file.name))
      return `Only one file named “${file.name}” can be uploaded at a time.`;
    names.add(file.name);
    if (file.size === 0) return `“${file.name}” is empty.`;
    if (file.size > limits.maxFileBytes)
      return `“${file.name}” exceeds the per-file size limit.`;
  }
  if (
    files.reduce((total, file) => total + file.size, 0) > limits.maxTotalBytes
  )
    return "The selected files exceed the total upload size limit.";
  return undefined;
}

async function safeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authorizationHeaders()),
      ...init?.headers,
    },
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    return (await safeFetch("/api/backend/health", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
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

function idempotencyKey() {
  return crypto.randomUUID();
}

export async function listProjects(): Promise<Project[]> {
  const response = await safeFetch("/api/backend/api/v1/projects", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load projects.");
  return z.array(projectSchema).parse(await response.json());
}

export async function createProject(
  name: string,
  description: string,
): Promise<Project> {
  const response = await safeFetch("/api/backend/api/v1/projects", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ name, description: description || null }),
  });
  if (!response.ok) throw new Error("Could not create the project.");
  return projectSchema.parse(await response.json());
}

export async function listProjectFiles(
  projectId: string,
): Promise<SnapshotFile[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/files`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load draft files.");
  return z.array(snapshotFileSchema).parse(await response.json());
}

export async function deleteProjectFile(
  projectId: string,
  fileId: string,
): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("The draft file could not be removed.");
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
  onProgress: (completed: number, total: number) => void,
): Promise<SnapshotFile[]> {
  const declarations = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      sha256: await sha256(file),
    })),
  );
  const created = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/upload-sessions`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ files: declarations }),
    },
  );
  if (created.status === 409)
    throw new Error(
      "This project cannot accept uploads while a build is queued or indexing.",
    );
  if (created.status === 422)
    throw new Error(
      "The selected files were rejected. Check their names, formats, and configured size limits.",
    );
  if (!created.ok) throw new Error("The upload session could not be created.");
  const session = uploadSessionSchema.parse(await created.json());
  for (const [index, part] of session.parts.entries()) {
    const file = files.find((candidate) => candidate.name === part.filename);
    if (!file)
      throw new Error("The upload response did not match the selected files.");
    const response = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: {
        ...(await authorizationHeaders()),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!response.ok) throw new Error(`${file.name} could not be uploaded.`);
    onProgress(index + 1, files.length);
  }
  const finalized = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/upload-sessions/${session.id}/finalize`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey() } },
  );
  if (!finalized.ok)
    throw new Error("The uploaded files did not pass validation.");
  return z.array(snapshotFileSchema).parse(await finalized.json());
}

export async function startProjectBuild(projectId: string): Promise<string> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/builds`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey() } },
  );
  if (response.status === 409)
    throw new Error("A project build is already queued or indexing.");
  if (!response.ok) throw new Error("The project build could not be queued.");
  return z
    .object({ buildId: z.string().uuid(), status: z.literal("queued") })
    .parse(await response.json()).buildId;
}

export async function getProjectBuild(
  projectId: string,
  buildId: string,
): Promise<BuildSummary> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("The build status could not be loaded.");
  return buildSummarySchema.parse(await response.json());
}
