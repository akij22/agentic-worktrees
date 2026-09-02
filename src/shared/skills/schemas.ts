import { z } from "zod";

export const skillIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const skillCompatibilitySchema = z.enum(["supported", "unsupported"]);
export const skillInstallationStateSchema = z.enum([
  "pending_verification",
  "installed",
  "invalid",
  "update_available",
]);

export const skillSummarySchema = z.object({
  id: skillIdSchema,
  name: skillIdSchema,
  description: z.string().trim().min(1).max(1_024),
  version: z.string().trim().min(1).max(80),
  source: z.enum(["bundled", "local"]),
  compatibility: z.object({
    codex: skillCompatibilitySchema,
    opencode: skillCompatibilitySchema,
  }),
  installationState: skillInstallationStateSchema,
  automaticInvocation: z.boolean(),
});

export const skillDetailSchema = skillSummarySchema.extend({
  license: z.string().trim().max(256).nullable().default(null),
  origin: z.string().trim().max(1_024),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reviewState: z.enum(["unreviewed", "reviewed", "rejected"]),
  instructionPreview: z.string().max(20_000),
});

export const skillInvocationRequestSchema = z.object({
  skillId: skillIdSchema,
  version: z.string().trim().min(1).max(80),
  arguments: z.string().trim().max(100_000).optional(),
});

export const codingAgentTurnRequestSchema = z.union([
  z.object({
    runId: z.string().trim().min(1),
    content: z.string().trim().min(1).max(100_000),
    reasoningVariant: z.string().trim().min(1).max(80).optional(),
    skillInvocation: z.never().optional(),
  }),
  z.object({
    runId: z.string().trim().min(1),
    skillInvocation: skillInvocationRequestSchema,
    reasoningVariant: z.string().trim().min(1).max(80).optional(),
    content: z.never().optional(),
  }),
]);

export type SkillSummaryDto = z.infer<typeof skillSummarySchema>;
export type SkillDetailDto = z.infer<typeof skillDetailSchema>;
export type SkillInvocationRequest = z.infer<typeof skillInvocationRequestSchema>;
export type CodingAgentTurnRequest = z.infer<typeof codingAgentTurnRequestSchema>;
