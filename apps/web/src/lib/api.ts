import { z } from "zod";
import { authorizationHeaders } from "./auth-token";

import {
  buildSummarySchema,
  accessActivitySchema,
  accessRequestContextSchema,
  conversationSchema,
  conversationListSchema,
  projectSchema,
  directoryPrincipalListSchema,
  governanceProjectSchema,
  projectAccessRequestSchema,
  projectMembershipSchema,
  snapshotFileSchema,
  uploadSessionSchema,
  plsqlObjectSchema,
  plsqlObjectSearchResultSchema,
  plsqlDependencyResultSchema,
  plsqlPathResultSchema,
  type BuildSummary,
  type AccessActivity,
  type AccessRequestContext,
  type Conversation,
  type ConversationList,
  type Project,
  type DirectoryPrincipal,
  type GovernanceProject,
  type PlsqlObject,
  type PlsqlDependencyResult,
  type PlsqlObjectKind,
  type PlsqlObjectSearchResult,
  type PlsqlPathResult,
  type ProjectAccessRequest,
  type ProjectMembership,
  type ProjectRole,
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
  plsqlEnabled: z.boolean().default(false),
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
export async function listConversations(
  projectId: string,
  state: "active" | "archived" = "active",
  cursor?: string,
): Promise<ConversationList> {
  const query = new URLSearchParams({ state, limit: "100" });
  if (cursor) query.set("cursor", cursor);
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/conversations?${query}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load conversations.");
  return conversationListSchema.parse(await response.json());
}
export async function renameConversation(
  id: string,
  name: string,
): Promise<Conversation> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  if (!response.ok) throw new Error("Could not rename the conversation.");
  return conversationSchema.parse(await response.json());
}
export async function archiveConversation(id: string): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404)
    throw new Error("Could not archive the conversation.");
}
export const deleteConversation = archiveConversation;
export async function restoreConversation(id: string): Promise<Conversation> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error("Could not restore the conversation.");
  return conversationSchema.parse(await response.json());
}
export async function purgeConversation(id: string): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/conversations/${encodeURIComponent(id)}/purge`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404)
    throw new Error("Could not permanently delete the conversation.");
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

export async function listGovernanceProjects(): Promise<GovernanceProject[]> {
  const response = await safeFetch(
    "/api/backend/api/v1/projects/governance/projects",
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error("Could not load tenant project governance.");
  return z.array(governanceProjectSchema).parse(await response.json());
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

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMembership[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/members`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load project members.");
  return z.array(projectMembershipSchema).parse(await response.json());
}

export async function searchDirectory(
  projectId: string,
  query: string,
): Promise<DirectoryPrincipal[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/directory?query=${encodeURIComponent(query)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not search the directory.");
  return directoryPrincipalListSchema.parse(await response.json()).items;
}

export async function addProjectMembers(
  projectId: string,
  principals: DirectoryPrincipal[],
  role: Exclude<ProjectRole, "owner">,
): Promise<ProjectMembership[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({
        principals: principals.map((item) => ({
          principalType: item.type,
          principalId: item.id,
          displayName: item.displayName,
        })),
        role,
      }),
    },
  );
  if (!response.ok) throw new Error("Project access could not be granted.");
  return z.array(projectMembershipSchema).parse(await response.json());
}

export async function changeProjectMemberRole(
  projectId: string,
  membershipId: string,
  role: ProjectRole,
): Promise<ProjectMembership> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(membershipId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  if (!response.ok) throw new Error("The member role could not be changed.");
  return projectMembershipSchema.parse(await response.json());
}

export async function removeProjectMember(
  projectId: string,
  membershipId: string,
): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(membershipId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Project access could not be removed.");
}

export async function listProjectAccessRequests(
  projectId: string,
): Promise<ProjectAccessRequest[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-requests`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load access requests.");
  return z.array(projectAccessRequestSchema).parse(await response.json());
}

export async function getProjectAccessContext(
  projectId: string,
): Promise<AccessRequestContext | null> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-context`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load project access details.");
  return accessRequestContextSchema.parse(await response.json());
}

export async function requestProjectAccess(
  projectId: string,
  note: string,
): Promise<ProjectAccessRequest> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-requests`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ note: note.trim() || null }),
    },
  );
  if (!response.ok) throw new Error("The access request could not be sent.");
  return projectAccessRequestSchema.parse(await response.json());
}

export async function cancelProjectAccessRequest(
  projectId: string,
  requestId: string,
): Promise<void> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-requests/${encodeURIComponent(requestId)}`,
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error("The access request could not be cancelled.");
}

export async function decideProjectAccessRequest(
  projectId: string,
  requestId: string,
  decision: "approved" | "denied",
  role?: Exclude<ProjectRole, "owner">,
): Promise<ProjectAccessRequest> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-requests/${encodeURIComponent(requestId)}`,
    { method: "PATCH", body: JSON.stringify({ decision, role }) },
  );
  if (!response.ok) throw new Error("The access request could not be updated.");
  return projectAccessRequestSchema.parse(await response.json());
}

export async function listProjectAccessActivity(
  projectId: string,
): Promise<AccessActivity[]> {
  const response = await safeFetch(
    `/api/backend/api/v1/projects/${encodeURIComponent(projectId)}/access-activity`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load access activity.");
  return z.array(accessActivitySchema).parse(await response.json());
}

export async function searchPlsqlObjects(
  query: string,
  options?: { kinds?: PlsqlObjectKind[]; limit?: number },
): Promise<PlsqlObjectSearchResult> {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) params.set("q", trimmed);
  for (const kind of options?.kinds ?? []) params.append("kinds", kind);
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  const suffix = params.size ? `?${params}` : "";
  const response = await safeFetch(
    `/api/backend/api/v1/plsql/objects${suffix}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not search PL/SQL objects.");
  return plsqlObjectSearchResultSchema.parse(await response.json());
}

export async function getPlsqlObject(
  objectId: string,
): Promise<PlsqlObject | null> {
  const params = new URLSearchParams({ objectId });
  const response = await safeFetch(
    `/api/backend/api/v1/plsql/object?${params}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load the PL/SQL object.");
  return plsqlObjectSchema.parse(await response.json());
}

async function loadPlsqlDependencies(
  path: string,
  objectId: string,
  errorMessage: string,
): Promise<PlsqlDependencyResult> {
  const params = new URLSearchParams({ objectId });
  const response = await safeFetch(
    `/api/backend/api/v1/plsql/${path}?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(errorMessage);
  return plsqlDependencyResultSchema.parse(await response.json());
}

export async function listPlsqlCallers(
  objectId: string,
): Promise<PlsqlDependencyResult> {
  return loadPlsqlDependencies("callers", objectId, "Could not load callers.");
}

export async function listPlsqlCallees(
  objectId: string,
): Promise<PlsqlDependencyResult> {
  return loadPlsqlDependencies("callees", objectId, "Could not load callees.");
}

export async function getPlsqlTableAccess(
  objectId: string,
): Promise<PlsqlDependencyResult> {
  return loadPlsqlDependencies(
    "table-access",
    objectId,
    "Could not load table access.",
  );
}

export async function findPlsqlPaths(
  fromId: string,
  toId: string,
  options?: { limit?: number },
): Promise<PlsqlPathResult> {
  const params = new URLSearchParams({ from: fromId, to: toId });
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  const response = await safeFetch(
    `/api/backend/api/v1/plsql/paths?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not find dependency paths.");
  return plsqlPathResultSchema.parse(await response.json());
}

export async function listPlsqlUnresolved(): Promise<PlsqlDependencyResult> {
  const response = await safeFetch("/api/backend/api/v1/plsql/unresolved", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load unresolved references.");
  return plsqlDependencyResultSchema.parse(await response.json());
}
