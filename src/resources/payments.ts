import { FacilPayValidationError } from '../errors';
import type { HttpClient, RequestOptions } from '../http';
import type { Payment, Refund } from '../types';

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

/**
 * Parameters accepted by {@link Payments.refund}.
 *
 * Mirrors the API `RefundPaymentDto`.
 */
export interface RefundPaymentDto {
  /**
   * Amount to refund in the smallest currency unit. When omitted the full
   * remaining balance is refunded. When provided it must be greater than 0.
   */
  amount?: number;
  /** Optional human readable reason for the refund. */
  reason?: string;
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

/** Filters accepted by {@link Payments.export}. */
export interface ExportPaymentsParams {
  status?: string;
  from?: string;
  to?: string;
  merchantId?: string;
}

/** A single entry of a payment timeline. */
export interface PaymentTimelineEntry {
  /** Event name, e.g. `payment.created`. */
  event: string;
  /** ISO 8601 timestamp of the event. */
  timestamp: string;
  /** Optional human readable description of the event. */
  description?: string;
  /** Optional event payload. */
  data?: Record<string, unknown>;
}

/** Response returned by {@link Payments.timeline}. */
export interface PaymentTimeline {
  paymentId: string;
  entries: PaymentTimelineEntry[];
}

/** Response returned by {@link Payments.invoice} and {@link Payments.publicInvoice}. */
export interface PaymentInvoice {
  id: string;
  paymentId: string;
  /** Publicly shareable token for the invoice. */
  token: string;
  /** URL to the hosted invoice. */
  url: string;
  /** ISO 8601 timestamp of when the invoice was issued. */
  issuedAt: string;
  /** Optional ISO 8601 timestamp of when the invoice was paid. */
  paidAt?: string;
}

/** Result of a single item in a bulk create request. */
export interface BulkCreatePaymentResult {
  /** Index of the item in the original request payload. */
  index: number;
  /** Whether the item was created successfully. */
  success: boolean;
  /** The created payment when `success` is true. */
  payment?: Payment;
  /** Error message when `success` is false. */
  error?: string;
}

/** Response returned by {@link Payments.createBulk}. */
export interface BulkCreatePaymentsResponseDto {
  /** Successfully created payments. */
  successes: BulkCreatePaymentResult[];
  /** Items that failed to be created. */
  failures: BulkCreatePaymentResult[];
}

/** Options accepted by {@link Payments.getQrCode}. */
export interface GetQrCodeOptions {
  /** Image format requested from the API. Defaults to `png`. */
  format?: 'png' | 'svg';
}

/** Per-request options supported by the payments resource. */
export interface PaymentsRequestOptions extends BaseRequestOptions {
  /** When true, sends the `x-test-mode: true` header. */
  testMode?: boolean;
}

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
   * An `Idempotency-Key` is generated automatically (and reused across
   * retries) unless you pass `options.idempotencyKey`.
   *
   * `POST /v1/payments`
   *
   * @param params - Amount, currency and optional payment details.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The created payment.
   * @throws {FacilPayValidationError} When the parameters fail client-side validation (no request is sent).
   * @throws {FacilPayAPIError} When the API rejects the request (e.g. `422` idempotency key reused with a different body).
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
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
   * Retrieve a single payment by id.
   *
   * `GET /v1/payments/:id`
   *
   * @param id - Payment id.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The payment.
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const payment = await facilpay.payments.retrieve('pay_123');
   * ```
   */
  retrieve(id: string, options?: PaymentsRequestOptions): Promise<Payment> {
    return this.http.get<Payment>(
      `/v1/payments/${encodeURIComponent(id)}`,
      withTestMode(options),
    );
  }

  /**
   * List payments with optional filters.
   *
   * `GET /v1/payments`
   *
   * @param params - Optional status, date range, paging and sorting filters.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns A page of payments.
   * @throws {FacilPayAPIError} When the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const page = await facilpay.payments.list({ status: 'succeeded', limit: 20 });
   * ```
   */
  list(
    params?: ListPaymentsParams,
    options?: PaymentsRequestOptions,
  ): Promise<Paginated<Payment>> {
    return this.http.get<Paginated<Payment>>(
      '/v1/payments',
      params ? { ...withTestMode(options), params: { ...params } } : withTestMode(options),
    );
  }

  /**
   * Cancel a payment that has not settled yet.
   *
   * `POST /v1/payments/:id/cancel`
   *
   * @param id - Payment id.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The cancelled payment.
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or can no longer be cancelled (`409`).
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const payment = await facilpay.payments.cancel('pay_123');
   * ```
   */
  cancel(id: string, options?: PaymentsRequestOptions): Promise<Payment> {
    return this.http.post<Payment>(
      `/v1/payments/${encodeURIComponent(id)}/cancel`,
      {},
      withTestMode(options),
    );
  }

  /**
   * Refund a payment, in full or in part.
   *
   * `POST /v1/payments/:id/refund`
   *
   * @param id - Payment id.
   * @param params - Optional refund amount and reason.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The created refund.
   * @throws {FacilPayValidationError} When the refund amount is not greater than 0 (no request is sent).
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or the refund is rejected (`409`).
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const refund = await facilpay.payments.refund('pay_123', { amount: 5 });
   * ```
   */
  refund(
    id: string,
    params?: RefundPaymentDto,
    options?: PaymentsRequestOptions,
  ): Promise<Refund> {
    if (params?.amount !== undefined && params.amount <= 0) {
      throw new FacilPayValidationError('Refund amount must be greater than 0');
    }
    return this.http.post<Refund>(
      `/v1/payments/${encodeURIComponent(id)}/refund`,
      params ?? {},
      withTestMode(options),
    );
  }

  /**
   * Export payments as a CSV document.
   *
   * `GET /v1/payments/export`
   *
   * @param params - Optional status, date range and merchant filters.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The raw CSV payload.
   * @throws {FacilPayAPIError} When the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  export(
    params?: ExportPaymentsParams,
    options?: PaymentsRequestOptions,
  ): Promise<string> {
    return this.http.get<string>(
      '/v1/payments/export',
      params ? { ...withTestMode(options), params: { ...params } } : withTestMode(options),
    );
  }

  /**
   * Retrieve the timeline of a payment.
   *
   * `GET /v1/payments/:id/timeline`
   *
   * @param id - Payment id.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The payment timeline.
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  timeline(id: string, options?: PaymentsRequestOptions): Promise<PaymentTimeline> {
    return this.http.get<PaymentTimeline>(
      `/v1/payments/${encodeURIComponent(id)}/timeline`,
      withTestMode(options),
    );
  }

  /**
   * Generate an invoice for a payment.
   *
   * `POST /v1/payments/:id/invoice`
   *
   * @param id - Payment id.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The generated invoice.
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  invoice(id: string, options?: PaymentsRequestOptions): Promise<PaymentInvoice> {
    return this.http.post<PaymentInvoice>(
      `/v1/payments/${encodeURIComponent(id)}/invoice`,
      {},
      withTestMode(options),
    );
  }

  /**
   * Retrieve a public invoice by token.
   *
   * `GET /v1/payments/invoices/:token`
   *
   * @param token - Public invoice token.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The invoice.
   * @throws {FacilPayAPIError} When the invoice does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  publicInvoice(token: string, options?: PaymentsRequestOptions): Promise<PaymentInvoice> {
    return this.http.get<PaymentInvoice>(
      `/v1/payments/invoices/${encodeURIComponent(token)}`,
      withTestMode(options),
    );
  }

  /**
   * Create multiple payments in a single request.
   *
   * `POST /v1/payments/bulk`
   *
   * @param payments - Payments to create.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The per-item results of the bulk request.
   * @throws {FacilPayValidationError} When any item fails client-side validation (no request is sent).
   * @throws {FacilPayAPIError} When the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  createBulk(
    payments: CreatePaymentParams[],
    options?: PaymentsRequestOptions,
  ): Promise<BulkCreatePaymentsResponseDto> {
    for (const params of payments) {
      validateCreatePaymentParams(params);
    }
    return this.http.post<BulkCreatePaymentsResponseDto>(
      '/v1/payments/bulk',
      { payments },
      withTestMode(options),
    );
  }

  /**
   * Retrieve the QR code of a payment.
   *
   * `GET /v1/payments/:id/qr-code`
   *
   * @param id - Payment id.
   * @param options - Per-request options; set `testMode: true` to send `x-test-mode: true`.
   * @returns The QR code image as a binary payload.
   * @throws {FacilPayAPIError} When the payment does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   */
  getQrCode(
    id: string,
    qrOptions?: GetQrCodeOptions,
    options?: PaymentsRequestOptions,
  ): Promise<ArrayBuffer> {
    return this.http.get<ArrayBuffer>(
      `/v1/payments/${encodeURIComponent(id)}/qr-code`,
      qrOptions ? { ...withTestMode(options), params: { ...qrOptions } } : withTestMode(options),
    );
  }
}

function withTestMode(options?: PaymentsRequestOptions): RequestOptions {
  if (!options?.testMode) {
    return options ?? {};
  }
  return {
    ...options,
    headers: { ...options.headers, 'x-test-mode': 'true' },
  };
}

function validateCreatePaymentParams(params: CreatePaymentParams): void {
  if (typeof params.amount !== 'number' || Number.isNaN(params.amount) || params.amount < 0.01) {
    throw new FacilPayValidationError('amount must be a number >= 0.01');
  }
  if (typeof params.currency !== 'string' || params.currency.length !== 3) {
    throw new FacilPayValidationError('currency must be a 3-character ISO 4217 code');
  }
  if (params.description !== undefined && params.description.length > 500) {
    throw new FacilPayValidationError('description must be at most 500 characters');
  }
  if (params.metadata !== undefined) {
    const entries = Object.entries(params.metadata);
    if (entries.length > 20) {
      throw new FacilPayValidationError('metadata must have at most 20 entries');
    }
    for (const [, value] of entries) {
      if (typeof value !== 'string' || value.length > 500) {
        throw new FacilPayValidationError('metadata values must be strings of at most 500 characters');
      }
    }
  }
  if (params.splits !== undefined) {
    const total = params.splits.reduce((sum, split) => sum + split.percentage, 0);
    if (Math.abs(total - 100) > 0.001) {
      throw new FacilPayValidationError('splits percentages must sum to 100');
    }
  }
}
