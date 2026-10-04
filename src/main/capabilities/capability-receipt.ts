import { z } from "zod";
const id = z.string().min(1).max(256);
export const capabilityHostOutcomeSchema = z.enum([
  "success",
  "reported_error",
  "thrown",
  "timeout",
  "cancelled",
]);
export const capabilityReceiptSchema = z
  .object({
    version: z.literal(1),
    invocationId: z.string().uuid(),
    outcome: capabilityHostOutcomeSchema,
  })
  .strict();
const observationBase = z.object({
  invocationId: z.string().uuid(),
  capabilityId: id,
  capabilityVersion: id,
  toolName: id,
});
export const capabilityHostObservationSchema = z.discriminatedUnion("type", [
  observationBase.extend({ type: z.literal("entered") }).strict(),
  observationBase
    .extend({
      type: z.literal("outcome"),
      outcome: capabilityHostOutcomeSchema,
    })
    .strict(),
]);
export type CapabilityHostOutcome = z.infer<typeof capabilityHostOutcomeSchema>;
export type CapabilityHostObservation = z.infer<
  typeof capabilityHostObservationSchema
>;
export type CapabilityReceipt = z.infer<typeof capabilityReceiptSchema>;

/** Only qualified terminal provider parsers may submit this receipt to the evidence service. */
export function readCapabilityReceipt(
  result: unknown,
): CapabilityReceipt | null {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  )
    return null;
  const last: unknown = result.content.at(-1);
  if (
    !last ||
    typeof last !== "object" ||
    !("type" in last) ||
    last.type !== "text" ||
    !("text" in last) ||
    typeof last.text !== "string"
  )
    return null;
  try {
    const envelope = z
      .object({ awCapabilityReceipt: capabilityReceiptSchema })
      .strict()
      .safeParse(JSON.parse(last.text));
    if (!envelope.success) return null;
    if (
      "_meta" in result &&
      result._meta &&
      typeof result._meta === "object" &&
      "aw.capabilityReceipt" in result._meta
    ) {
      const meta = capabilityReceiptSchema.safeParse(
        result._meta["aw.capabilityReceipt"],
      );
      if (
        !meta.success ||
        JSON.stringify(meta.data) !==
          JSON.stringify(envelope.data.awCapabilityReceipt)
      )
        return null;
    }
    return envelope.data.awCapabilityReceipt;
  } catch {
    return null;
  }
}

/** Drop the reserved host receipt content before OpenCode's tool output reaches transcript/IPC. */
export function stripCapabilityReceiptText(output: string): string {
  const envelope = z
    .object({ awCapabilityReceipt: capabilityReceiptSchema })
    .strict();
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(clean).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      if (envelope.safeParse(value).success) return undefined;
      if (
        "type" in value &&
        value.type === "text" &&
        "text" in value &&
        typeof value.text === "string"
      ) {
        try {
          if (envelope.safeParse(JSON.parse(value.text)).success)
            return undefined;
        } catch {
          /* ordinary tool text */
        }
      }
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "aw.capabilityReceipt")
          .map(([key, item]) => [key, clean(item)]),
      );
    }
    return value;
  };
  try {
    const parsed: unknown = JSON.parse(output);
    const safe = clean(parsed);
    if (safe === undefined) return "";
    if (JSON.stringify(parsed) !== JSON.stringify(safe))
      return JSON.stringify(safe);
  } catch {
    /* plain provider output */
  }
  return output
    .split("\n")
    .filter((line) => {
      try {
        return !envelope.safeParse(JSON.parse(line)).success;
      } catch {
        return true;
      }
    })
    .join("\n");
}
