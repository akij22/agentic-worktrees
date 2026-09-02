import { z } from "zod";
import type { CapabilityErrorCode } from "@agentic-worktrees/capability-sdk";

const identifierSchema = z.string().min(1).max(256);
const settingsSchema = z.record(identifierSchema, z.record(identifierSchema, z.unknown()));
const capabilityErrorCodeSchema = z.enum([
  "invalid_input",
  "missing_secret",
  "permission_denied",
  "rate_limited",
  "upstream_unavailable",
  "upstream_protocol_error",
  "cancelled",
  "activation_failed",
  "agent_reload_failed",
  "internal_error",
] satisfies readonly CapabilityErrorCode[]);

export const mainToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host.initialize"), runId: identifierSchema, token: z.string().min(32).max(256), activeCapabilityIds: z.array(identifierSchema).max(100), settings: settingsSchema }).strict(),
  z.object({ type: z.literal("host.capabilities.set"), requestId: identifierSchema, capabilityIds: z.array(identifierSchema).max(100), settings: settingsSchema }).strict(),
  z.object({ type: z.literal("host.secret.result"), requestId: identifierSchema, value: z.string().min(1).optional(), errorCode: z.literal("missing_secret").optional() }).strict().refine((message) => Boolean(message.value) !== Boolean(message.errorCode)),
]);

export const hostToMainMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host.ready"), runId: identifierSchema, port: z.number().int().min(1).max(65_535) }).strict(),
  z.object({ type: z.literal("host.secret.request"), requestId: identifierSchema, capabilityId: identifierSchema, settingKey: identifierSchema }).strict(),
  z.object({ type: z.literal("host.capabilities.applied"), requestId: identifierSchema, toolNames: z.array(identifierSchema).max(1_000) }).strict(),
  z.object({ type: z.literal("host.error"), requestId: identifierSchema.optional(), code: capabilityErrorCodeSchema, message: z.string().min(1).max(2_000) }).strict(),
]);

export type MainToHostMessage = z.infer<typeof mainToHostMessageSchema>;
export type HostToMainMessage = z.infer<typeof hostToMainMessageSchema>;

export function isMainToHostMessage(value: unknown): value is MainToHostMessage {
  return mainToHostMessageSchema.safeParse(value).success;
}

export function isHostToMainMessage(value: unknown): value is HostToMainMessage {
  return hostToMainMessageSchema.safeParse(value).success;
}
