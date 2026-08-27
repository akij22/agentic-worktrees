export type CapabilityErrorCode =
  | "invalid_input"
  | "missing_secret"
  | "permission_denied"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_protocol_error"
  | "cancelled"
  | "activation_failed"
  | "agent_reload_failed"
  | "internal_error";

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;

  constructor(code: CapabilityErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = "CapabilityError";
    this.code = code;
  }
}
