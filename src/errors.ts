export type FacilPayErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface FacilPayErrorOptions {
  code?: FacilPayErrorCode;
  status?: number;
  cause?: unknown;
  details?: unknown;
}

/**
 * Base error type thrown by the FacilPay SDK.
 *
 * The API key is never attached to the error, its message, or its serialized
 * form, so it cannot leak through logs or `JSON.stringify`.
 */
export class FacilPayError extends Error {
  readonly code: FacilPayErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, options: FacilPayErrorOptions = {}) {
    super(message);
    this.name = 'FacilPayError';
    this.code = options.code ?? 'UNKNOWN';
    this.status = options.status;
    this.details = options.details;

    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }

    // Restore prototype chain when targeting ES5/ES2015 down-level output.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { name: string; message: string; code: FacilPayErrorCode; status?: number } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      ...(this.status !== undefined ? { status: this.status } : {}),
    };
  }
}

export function isFacilPayError(error: unknown): error is FacilPayError {
  return error instanceof FacilPayError;
}
