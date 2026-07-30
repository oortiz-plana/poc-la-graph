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
  createdAt: z.string(),
  updatedAt: z.string(),
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
export type UIEvent = z.infer<typeof uiEventSchema>;
