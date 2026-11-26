import type { HttpClient } from '../core/http';
import type { PageEnvelope, PagePromise } from '../core/pagination';
import type { ResourceRequestOptions } from './request-options';
import {
  constructEvent,
  type ConstructEventOptions,
  type WebhookPayload,
} from '../webhooks/verify';
import type { FacilPayEvent, WebhookEventType } from '../webhooks/events';

/**
 * Supported webhook event names.
 *
 * Derived from the single source-of-truth catalog in `../webhooks/events` so
 * that subscriptions and `constructEvent()` payloads can never drift apart.
 *
 * @deprecated Use {@link WebhookEventType} from `../webhooks/events` instead.
 */
export type WebhookEvent = WebhookEventType;

/** A registered webhook endpoint. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  /**
   * Signing secret (`whsec_…`).
   *
   * Only returned in full on creation and after rotation. Store it immediately —
   * it cannot be retrieved again afterwards.
   */
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

/** Parameters for registering a new webhook endpoint. */
export interface CreateWebhookParams {
  url: string;
  events: WebhookEvent[];
}

/** Parameters for updating an existing webhook endpoint. */
export interface UpdateWebhookParams {
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
}

/** Result of a test delivery to a webhook endpoint. */
export interface WebhookTestResult {
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

/** Result of retrying a webhook delivery. */
export interface WebhookDeliveryRetryResult {
  deliveryId: string;
  status: string;
}

/**
 * Delivery status of a webhook delivery attempt.
 *
 * - `pending` — queued, not yet attempted.
 * - `delivered` — the endpoint acknowledged the delivery (`2xx`).
 * - `failed` — the delivery attempt failed and may be retried.
 * - `retrying` — a retry is currently in flight.
 */
export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'retrying';

/** A single webhook delivery attempt. */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  statusCode?: number;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
}

/** Filters accepted by {@link WebhooksResource.listDeliveries}. */
export interface ListWebhookDeliveriesParams {
  page?: number;
  limit?: number;
  status?: WebhookDeliveryStatus;
  eventType?: WebhookEvent;
  /** Only include deliveries created at or after this ISO 8601 timestamp. */
  since?: string;
}

/** Parameters accepted by {@link WebhooksResource.retryFailedDeliveries}. */
export interface RetryFailedDeliveriesParams {
  /** Only retry failed deliveries created at or after this ISO 8601 timestamp. */
  since?: string;
}

/** Result of a bulk retry of failed webhook deliveries. */
export interface RetryFailedDeliveriesResult {
  retried: number;
  deliveries: WebhookDeliveryRetryResult[];
}

/**
 * Webhook endpoints resource.
 *
 * Merchants register HTTPS endpoints that receive signed event deliveries.
 */
export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Register a new webhook endpoint.
   *
   * The returned `secret` (`whsec_…`) is only returned in full here and after
   * rotation. Store it immediately — it cannot be retrieved again afterwards.
   *
   * `POST /v1/webhooks`
   *
   * @param params - HTTPS URL and subscribed events.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns The registered endpoint, including its signing `secret`.
   * @throws {FacilPayAPIError} When the API rejects the request (e.g. `422` invalid URL).
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const endpoint = await facilpay.webhooks.create({
   *   url: 'https://example.com/webhooks/facilpay',
   *   events: ['payment.succeeded'],
   * });
   * ```
   */
  create(params: CreateWebhookParams, options?: ResourceRequestOptions): Promise<WebhookEndpoint> {
    return this.http.request<WebhookEndpoint>({
      method: 'POST',
      path: '/v1/webhooks',
      body: params,
      ...options,
    });
  }

  /**
   * List all registered webhook endpoints.
   *
   * `GET /v1/webhooks`
   *
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns The registered endpoints.
   * @throws {FacilPayAPIError} When the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const endpoints = await facilpay.webhooks.list();
   * ```
   */
  list(options?: ResourceRequestOptions): Promise<WebhookEndpoint[]> {
    return this.http.request<WebhookEndpoint[]>({
      method: 'GET',
      path: '/v1/webhooks',
      ...options,
    });
  }

  /**
   * Fetch a single webhook endpoint by id.
   *
   * `GET /v1/webhooks/:id`
   *
   * @param id - Webhook endpoint id.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns The webhook endpoint.
   * @throws {FacilPayAPIError} When the webhook endpoint does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const endpoint = await facilpay.webhooks.retrieve('wh_123');
   * ```
   */
  retrieve(id: string, options?: ResourceRequestOptions): Promise<WebhookEndpoint> {
    return this.http.request<WebhookEndpoint>({
      method: 'GET',
      path: `/v1/webhooks/${id}`,
      ...options,
    });
  }

  /**
   * List the delivery attempts of a webhook endpoint (paginated).
   *
   * Filter by delivery `status`, `eventType`, and/or `since` (ISO 8601).
   * Use this to find a `deliveryId` for {@link retryDelivery}.
   *
   * `GET /v1/webhooks/:id/deliveries`
   *
   * @param id - Webhook endpoint id.
   * @param params - Optional paging, status, event type and `since` filters.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns A page of delivery attempts.
   * @throws {FacilPayAPIError} When the webhook endpoint does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const { data } = await facilpay.webhooks.listDeliveries('wh_123', { status: 'failed' });
   * ```
   */
  listDeliveries(
    id: string,
    params?: ListWebhookDeliveriesParams,
    options?: ResourceRequestOptions,
  ): PagePromise<WebhookDelivery> {
    return this.http.request<PageEnvelope<WebhookDelivery>>({
      method: 'GET',
      path: `/v1/webhooks/${id}/deliveries`,
      query: params,
      ...options,
    }) as PagePromise<WebhookDelivery>;
  }

  /**
   * Bulk-retry all failed deliveries of a webhook endpoint.
   *
   * Useful after an outage: pass `since` to only retry deliveries that failed
   * after a given point in time.
   *
   * `POST /v1/webhooks/:id/deliveries/retry`
   *
   * @param id - Webhook endpoint id.
   * @param params - Optional `since` (ISO 8601) lower bound for failed deliveries.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns The number of retried deliveries and their retry results.
   * @throws {FacilPayAPIError} When the webhook endpoint does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * const { retried } = await facilpay.webhooks.retryFailedDeliveries('wh_123', {
   *   since: '2024-01-01T00:00:00Z',
   * });
   * ```
   */
  retryFailedDeliveries(
    id: string,
    params?: RetryFailedDeliveriesParams,
    options?: ResourceRequestOptions,
  ): Promise<RetryFailedDeliveriesResult> {
    return this.http.request<RetryFailedDeliveriesResult>({
      method: 'POST',
      path: `/v1/webhooks/${id}/deliveries/retry`,
      body: params,
      ...options,
    });
  }

  /**
   * Update a webhook endpoint's URL, subscribed events, or active state.
   *
   * `PATCH /v1/webhooks/:id`
   *
   * @param id - Webhook endpoint id.
   * @param params - Fields to change.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns The updated webhook endpoint.
   * @throws {FacilPayAPIError} When the webhook endpoint does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * await facilpay.webhooks.update('wh_123', { isActive: false });
   * ```
   */
  update(
    id: string,
    params: UpdateWebhookParams,
    options?: ResourceRequestOptions,
  ): Promise<WebhookEndpoint> {
    return this.http.request<WebhookEndpoint>({
      method: 'PATCH',
      path: `/v1/webhooks/${id}`,
      body: params,
      ...options,
    });
  }

  /**
   * Delete a webhook endpoint.
   *
   * `DELETE /v1/webhooks/:id`
   *
   * @param id - Webhook endpoint id.
   * @param options - Per-request options (headers, idempotency key, signal, timeout, ...).
   * @returns Resolves once the endpoint is deleted.
   * @throws {FacilPayAPIError} When the webhook endpoint does not exist (`404`) or the API rejects the request.
   * @throws {FacilPayConnectionError} When the API cannot be reached or the request times out.
   *
   * @example
   * ```ts
   * await facilpay.webhooks.delete('wh_123');
   * ```
   */
  delete(id: string, options?: ResourceRequestOptions): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/v1/webhooks/${id}`,
      ...options,
    });
  }

  /**
   * Send a test delivery to a webhook endpoint.
   *
   * `POST /v1/webhooks/:id/test`
   *
   * @param id - Webhook endpoint id.
   * @param options - Per-requ
