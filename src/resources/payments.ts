import { FacilPayValidationError } from '../errors';
import type { HttpClient, RequestOptions } from '../http';
import type { PagePromise } from '../pagination';
import type { Payment } from '../types';

/**
 * Parameters accepted by {@link Payments.create}.
 *
 * Mirrors the API `CreatePaymentDto`.
 */
export interface CreatePaymentParams {
  /** Amount in the smallest currency unit, must be >= 0.01. */
  amount: number;
  /** ISO 4217 currency code (exactly 3 characters). */
  currency: string;
  /** Optional human readable description (max 500 characters). */
  description?: string;
  /** URL the API will call once the payment settles. */
  callbackUrl?: string;
  /** Identifier of the merchant receiving the payment. */
  merchantId?: string;
  /** Email of the merchant receiving the payment. */
  merchantEmail?: string;
  /** Email of the payer. */
  payerEmail?: string;
  /** Arbitrary key/value metadata (max 20 entries, values max 500 characters). */
  metadata?: Record<string, string>;
  /** Lifetime of the payment in seconds. */
  expiresIn?: number;
  /** Identifier of the payment link this payment originates from. */
  paymentLinkId?: string;
  /** Split configuration; percentages must sum to 100. */
  splits?: PaymentSplit[];
}

/** A single split entry attached to a payment. */
export interface PaymentSplit {
  /** Identifier of the account receiving the split. */
  accountId: string;
  /** Percentage of the payment routed to this account. */
  percentage: number;
}

/** Filters accepted by {@link Payments.list}. */
export interface ListPaymentsParams {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Per-request options supported by the payments resource. */
export interface PaymentsRequestOptions extends RequestOptions {
  /** When true, sends the `x-test-mode: true` header. */
  testMode?: boolean;
}

const MAX_METADATA_ENTRIES = 20;
const MAX_METADATA_VALUE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 500;
const CURRENCY_LENGTH = 3;

/**
 * Payments resource.
 *
 * Exposed as `facilpay.payments`.
 */
export class Payments {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new payment.
   *
   * @example
   * ```ts
   * const payment = await facilpay.payments.create({
   *   amount: 10.5,
   *   currency: 'EUR',
   *   description: 'Order #1234',
   * });
   * ```
   */
  create(params: CreatePaymentParams, options?: PaymentsRequestOptions): Promise<Payment> {
    validateCreatePaymentParams(params);
    return this.http.post<Payment>('/v1/payments', params, withTestMode(options));
  }

  /**
   * Retrieve a payment by its identifier.
   *
   * @example
   * ```ts
   * const payment = await facilpay.payments.retrieve('pay_123');
   * ```
   */
  retrieve(id: string, options?: PaymentsRequestOptions): Promise<Payment> {
    return this.http.get<Payment>(`/v1/payments/${encodeURIComponent(id)}`, withTestMode(options));
  }

  /**
   * List payments, optionally filtered.
   *
   * @example
   * ```ts
   * const page = await facilpay.payments.list({ status: 'succeeded', limit: 20 });
   * for await (const payment of page) {
   *   console.log(payment.id);
   * }
   * ```
   */
  list(params?: ListPaymentsParams, options?: PaymentsRequestOptions): PagePromise<Payment> {
    return this.http.getPage<Payment>('/v1/payments', params, withTestMode(options));
  }

  /**
   * Cancel a payment that has not settled yet.
   *
   * @example
   * ```ts
   * const payment = await facilpay.payments.cancel('pay_123');
   * ```
   */
  cancel(id: string, options?: PaymentsRequestOptions): Promise<Payment> {
    return this.http.post<Payment>(
      `/v1/payments/${encodeURIComponent(id)}/cancel`,
      undefined,
      withTestMode(options),
    );
  }
}

function withTestMode(options?: PaymentsRequestOptions): RequestOptions | undefined {
  if (!options?.testMode) {
    return options;
  }
  return {
    ...options,
    headers: { ...options.headers, 'x-test-mode': 'true' },
  };
}

function validateCreatePaymentParams(params: CreatePaymentParams): void {
  if (typeof params.amount !== 'number' || Number.isNaN(params.amount) || params.amount < 0.01) {
    throw new FacilPayValidationError('`amount` must be a number greater than or equal to 0.01.');
  }

  if (typeof params.currency !== 'string' || params.currency.length !== CURRENCY_LENGTH) {
    throw new FacilPayValidationError('`currency` must be a 3 character ISO 4217 code.');
  }

  if (params.description !== undefined && params.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new FacilPayValidationError(
      `\`description\` must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  if (params.metadata !== undefined) {
    const entries = Object.entries(params.metadata);
    if (entries.length > MAX_METADATA_ENTRIES) {
      throw new FacilPayValidationError(
        `\`metadata\` must contain at most ${MAX_METADATA_ENTRIES} entries.`,
      );
    }
    for (const [key, value] of entries) {
      if (typeof value !== 'string' || value.length > MAX_METADATA_VALUE_LENGTH) {
        throw new FacilPayValidationError(
          `\`metadata.${key}\` must be a string of at most ${MAX_METADATA_VALUE_LENGTH} characters.`,
        );
      }
    }
  }

  if (params.splits !== undefined) {
    if (!Array.isArray(params.splits) || params.splits.length === 0) {
      throw new FacilPayValidationError('`splits` must be a non-empty array when provided.');
    }
    const total = params.splits.reduce((sum, split) => sum + split.percentage, 0);
    if (Math.abs(total - 100) > Number.EPSILON) {
      throw new FacilPayValidationError('`splits` percentages must sum to 100.');
    }
  }
}
