import { z } from "zod";

const provenance = z.enum(["explicit", "extracted", "inferred", "unknown"]);
export const citationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  nodeId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  relationship: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  provenance,
  excerpt: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  document: z.string().nullish(),
  article: z.string().nullish(),
  paragraph: z.string().nullish(),
  startLine: z.number().int().positive().nullish(),
  endLine: z.number().int().positive().nullish(),
  pageNumber: z.number().int().positive().nullish(),
  sectionPath: z.array(z.string()).nullish(),
});
export const graphEvidenceSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      type: z.string(),
      provenance,
      properties: z
        .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
      source: z.string().nullable().optional(),
      excerpt: z.string().nullable().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      sourceNodeId: z.string(),
      targetNodeId: z.string(),
      relationship: z.string(),
      provenance,
      properties: z
        .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
    }),
  ),
  paths: z.array(
    z.object({
      id: z.string(),
      nodeIds: z.array(z.string()),
      edgeIds: z.array(z.string()),
    }),
  ),
});
export const answerSchema = z.object({
  requestId: z.string(),
  conversationId: z.string(),
  answer: z.string(),
  status: z.literal("completed"),
  responseType: z.enum(["answer", "clarification", "insufficient"]),
  confidence: z.enum(["high", "medium", "low", "insufficient"]),
  graphVersion: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  citations: z.array(citationSchema),
  graphEvidence: graphEvidenceSchema,
  warnings: z.array(z.string()),
});
export const conversationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      status: z.enum(["pending", "completed", "failed"]),
      createdAt: z.string(),
      result: answerSchema.nullable().optional(),
    }),
  ),
});
export const conversationSummarySchema = conversationSchema.omit({
  messages: true,
});
export const conversationListSchema = z.object({
  items: z.array(conversationSummarySchema).max(100),
  nextCursor: z.string().nullable(),
});
const base = {
  requestId: z.string(),
  conversationId: z.string(),
  timestamp: z.string(),
};
export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("message.started"),
    messageId: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("tool.started"),
    toolCallId: z.string(),
    tool: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("tool.completed"),
    toolCallId: z.string(),
    tool: z.string(),
    summary: z.object({
      nodeCount: z.number(),
      edgeCount: z.number(),
      truncated: z.boolean(),
    }),
  }),
  z.object({ ...base, type: z.literal("answer.delta"), delta: z.string() }),
  z.object({
    ...base,
    type: z.literal("citation.available"),
    citation: citationSchema,
  }),
  z.object({
    ...base,
    type: z.literal("message.completed"),
    result: answerSchema,
  }),
  z.object({
    ...base,
    type: z.literal("message.failed"),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);
export const uiEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("activity"),
    activity: z.enum(["searching", "writing"]),
  }),
  z.object({ kind: z.literal("citation"), citation: citationSchema }),
  z.object({ kind: z.literal("completed"), result: answerSchema }),
  z.object({
    kind: z.literal("failed"),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);

export type Citation = z.infer<typeof citationSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type GraphEvidence = z.infer<typeof graphEvidenceSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationList = z.infer<typeof conversationListSchema>;
export type UIEvent = z.infer<typeof uiEventSchema>;

export const buildSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "building", "ready", "failed"]),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.enum(["draft", "queued", "building", "ready", "failed", "archived"]),
  creator: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  activeGraphVersion: z.string().nullable(),
  draftFileCount: z.number().int().nonnegative(),
  activeDocumentCount: z.number().int().nonnegative(),
  currentBuild: buildSummarySchema.nullable(),
  lastBuild: buildSummarySchema.nullable(),
  allowedActions: z.object({
    createConversation: z.boolean(),
    editDraft: z.boolean(),
    build: z.boolean(),
    archive: z.boolean(),
    restore: z.boolean(),
    purge: z.boolean(),
    manageAccess: z.boolean().default(false),
    viewAccessActivity: z.boolean().default(false),
    requestAccess: z.boolean().default(false),
  }),
  currentAccess: z.object({
    effectiveRole: z.enum(["viewer", "contributor", "manager", "owner"]),
    origins: z.array(
      z.object({
        membershipId: z.string().uuid(),
        principalType: z.enum(["user", "group"]),
        principalId: z.string().min(1),
        displayName: z.string().min(1),
        role: z.enum(["viewer", "contributor", "manager", "owner"]),
      }),
    ),
  }),
});
export const projectRoleSchema = z.enum([
  "viewer",
  "contributor",
  "manager",
  "owner",
]);
export const projectMembershipSchema = z.object({
  id: z.string().uuid(),
  principalType: z.enum(["user", "group"]),
  principalId: z.string().min(1),
  displayName: z.string().min(1),
  role: projectRoleSchema,
  accessOrigin: z.enum(["direct", "group"]),
  createdAt: z.string(),
});
export const directoryPrincipalSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["user", "group"]),
  displayName: z.string().min(1),
  secondaryText: z.string().nullable(),
});
export const directoryPrincipalListSchema = z.object({
  items: z.array(directoryPrincipalSchema),
  nextCursor: z.string().nullable(),
});
export const projectAccessRequestSchema = z.object({
  id: z.string().uuid(),
  requesterId: z.string(),
  requesterName: z.string(),
  note: z.string().nullable(),
  status: z.enum(["pending", "approved", "denied", "cancelled"]),
  decidedRole: projectRoleSchema.nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export const accessRequestContextSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string().min(1),
  status: z.enum(["available", "pending", "denied"]),
  requestId: z.string().uuid().nullable(),
});
export const accessActivitySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string(),
  action: z.string(),
  targetName: z.string().nullable(),
  occurredAt: z.string(),
});
export const governanceProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  state: z.enum(["draft", "queued", "building", "ready", "failed", "archived"]),
  ownerCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export const snapshotFileSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mediaType: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z
    .enum([
      "uploaded",
      "queued",
      "validating",
      "converting",
      "buildingGraph",
      "indexing",
      "ready",
      "failed",
    ])
    .nullish(),
  progressPercent: z.number().int().min(0).max(100).nullish(),
  errorCode: z.string().nullish(),
  uploadedAt: z.string().nullish(),
});
export const uploadSessionSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  parts: z.array(
    z.object({
      id: z.string().uuid(),
      filename: z.string(),
      uploadUrl: z.string(),
    }),
  ),
});
export const plsqlObjectKindSchema = z.enum([
  "Table",
  "View",
  "Package",
  "Sequence",
  "Trigger",
  "Index",
  "Synonym",
  "Type",
  "Procedure",
  "Function",
  "AnonymousBlock",
]);
export const plsqlSourceCoordinateSchema = z.object({
  sourceFileId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  path: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  startLine: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
  startColumn: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
  startOffset: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
  endOffset: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
});
export const plsqlObjectSchema = z.object({
  id: z.string(),
  kind: plsqlObjectKindSchema,
  name: z.string(),
  schema: z.string(),
  qualifiedName: z.string(),
  projectId: z.string(),
  owner: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  signature: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  returnType: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  declaration: plsqlSourceCoordinateSchema
    .nullish()
    .transform((value) => value ?? null),
});
export const plsqlObjectSearchResultSchema = z.object({
  items: z.array(plsqlObjectSchema),
  truncated: z.boolean(),
  count: z.number().int().nonnegative(),
});
export const plsqlRelationshipSchema = z.enum([
  "CALLS",
  "READS",
  "WRITES",
  "VIEW_DEPENDS_ON",
  "TRIGGER_ON",
  "INDEXES",
  "SYNONYM_FOR",
  "DECLARES",
  "CONTAINS",
]);
export const plsqlResolutionSchema = z.enum([
  "EXACT",
  "INFERRED",
  "AMBIGUOUS",
  "UNRESOLVED",
]);
export const plsqlObjectReferenceSchema = z.object({
  id: z.string(),
  kind: plsqlObjectKindSchema,
  name: z.string(),
  schema: z.string(),
  qualifiedName: z.string(),
});
export const plsqlDependencySchema = z.object({
  id: z.string(),
  relationship: plsqlRelationshipSchema,
  source: plsqlObjectReferenceSchema,
  target: plsqlObjectReferenceSchema,
  resolution: plsqlResolutionSchema,
  evidence: plsqlSourceCoordinateSchema
    .nullish()
    .transform((value) => value ?? null),
});
export const plsqlDependencyResultSchema = z.object({
  items: z.array(plsqlDependencySchema),
  truncated: z.boolean(),
  count: z.number().int().nonnegative(),
});
export const plsqlPathSchema = z.object({
  id: z.string(),
  nodes: z.array(plsqlObjectReferenceSchema),
  relationships: z.array(plsqlDependencySchema),
  hopCount: z.number().int().positive(),
});
export const plsqlPathResultSchema = z.object({
  items: z.array(plsqlPathSchema),
  truncated: z.boolean(),
  count: z.number().int().nonnegative(),
});
export const plsqlSourceFileSchema = z.object({
  fileId: z.string(),
  path: z.string(),
});
export const plsqlSourceHighlightSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export const plsqlSourceContentSchema = z.object({
  file: plsqlSourceFileSchema,
  lines: z.array(z.string()),
  highlight: plsqlSourceHighlightSchema
    .nullish()
    .transform((value) => value ?? null),
});
export const plsqlImpactItemSchema = z.object({
  id: z.string(),
  dependent: plsqlObjectReferenceSchema,
  distance: z.number().int().positive(),
  paths: z.array(plsqlPathSchema),
});
export const plsqlImpactResultSchema = z.object({
  object: plsqlObjectReferenceSchema,
  items: z.array(plsqlImpactItemSchema),
  truncated: z.boolean(),
  count: z.number().int().nonnegative(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type ProjectMembership = z.infer<typeof projectMembershipSchema>;
export type DirectoryPrincipal = z.infer<typeof directoryPrincipalSchema>;
export type ProjectAccessRequest = z.infer<typeof projectAccessRequestSchema>;
export type AccessRequestContext = z.infer<typeof accessRequestContextSchema>;
export type AccessActivity = z.infer<typeof accessActivitySchema>;
export type GovernanceProject = z.infer<typeof governanceProjectSchema>;
export type BuildSummary = z.infer<typeof buildSummarySchema>;
export type SnapshotFile = z.infer<typeof snapshotFileSchema>;
export type PlsqlSourceCoordinate = z.infer<typeof plsqlSourceCoordinateSchema>;
export type PlsqlObjectKind = z.infer<typeof plsqlObjectKindSchema>;
export type PlsqlObject = z.infer<typeof plsqlObjectSchema>;
export type PlsqlObjectSearchResult = z.infer<
  typeof plsqlObjectSearchResultSchema
>;
export type PlsqlRelationship = z.infer<typeof plsqlRelationshipSchema>;
export type PlsqlResolution = z.infer<typeof plsqlResolutionSchema>;
export type PlsqlObjectReference = z.infer<typeof plsqlObjectReferenceSchema>;
export type PlsqlDependency = z.infer<typeof plsqlDependencySchema>;
export type PlsqlDependencyResult = z.infer<typeof plsqlDependencyResultSchema>;
export type PlsqlPath = z.infer<typeof plsqlPathSchema>;
export type PlsqlPathResult = z.infer<typeof plsqlPathResultSchema>;
export type PlsqlSourceFile = z.infer<typeof plsqlSourceFileSchema>;
export type PlsqlSourceHighlight = z.infer<typeof plsqlSourceHighlightSchema>;
export type PlsqlSourceContent = z.infer<typeof plsqlSourceContentSchema>;
export type PlsqlImpactItem = z.infer<typeof plsqlImpactItemSchema>;
export type PlsqlImpactResult = z.infer<typeof plsqlImpactResultSchema>;
