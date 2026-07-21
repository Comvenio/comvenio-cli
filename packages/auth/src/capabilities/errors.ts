export type CapabilityErrorCode =
  | "CAPABILITY_INVALID"
  | "CONTEXT_MISSING"
  | "VERSION_STALE"
  | "TENANT_MISMATCH"
  | "PERMISSION_DENIED";

export class CapabilityContractError extends Error {
  readonly code: CapabilityErrorCode;

  constructor(code: CapabilityErrorCode, message: string) {
    super(message);
    this.name = "CapabilityContractError";
    this.code = code;
  }

  toJSON(): { error: CapabilityErrorCode } {
    return { error: this.code };
  }
}

export function assertCapability(
  condition: unknown,
  code: CapabilityErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new CapabilityContractError(code, message);
}
