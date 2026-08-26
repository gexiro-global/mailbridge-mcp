export class MailBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MailBridgeError";
  }
}

export function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof MailBridgeError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "INTERNAL_ERROR", message: "The operation failed", retryable: false };
}
