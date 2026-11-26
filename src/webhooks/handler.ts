import { FacilPaySignatureVerificationError } from '../errors';
import { constructEvent, type ConstructEventOptions, type WebhookPayload } from './verify';
import type {
  DisputeOpenedEvent,
  FacilPayEvent,
  PaymentCompletedEvent,
  PaymentCreatedEvent,
  PaymentExpiredEvent,
  PaymentFailedEvent,
  PaymentSplitProcessedEvent,
  RefundIssuedEvent,
  TestEvent,
  TransactionMultisigCompletedEvent,
  TransactionMultisigRequiredEvent,
  WebhookEventType,
} from './events';

// ---------------------------------------------------------------------------
// Per-event handler map — strongly typed per event type
// ---------------------------------------------------------------------------

/**
 * Map from every {@link WebhookEventType} to the event object it carries.
 * Used to infer the correct handler signature per key.
 *
 * @internal
 */
export interface WebhookEventMap {
  'payment.created': PaymentCreatedEvent;
  'payment.completed': PaymentCompletedEvent;
  'payment.failed': PaymentFailedEvent;
  'payment.expired': PaymentExpiredEvent;
  'payment.split_processed': PaymentSplitProcessedEvent;
  'refund.issued': RefundIssuedEvent;
  'dispute.opened': DisputeOpenedEvent;
  'transaction.multisig_required': TransactionMultisigRequiredEvent;
  'transaction.multisig_completed': TransactionMultisigCompletedEvent;
  test: TestEvent;
}

/** An async or sync handler for a specific event type. */
export type WebhookEventHandler<K extends WebhookEventType> = (
  event: WebhookEventMap[K],
) => void | Promise<void>;

/** The `on` map passed to {@link createWebhookHandler}. */
export type WebhookHandlerMap = {
  [K in WebhookEventType]?: WebhookEventHandler<K>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WebhookHandlerOptions extends ConstructEventOptions {
  /**
   * The endpoint signing secret (`whsec_…`). Pass an array of two secrets
   * during key rotation — both are tried before rejecting.
   */
  secret: string | string[];

  /**
   * Per-event handlers. Only the types you list are called; unrecognised types
   * are silently ignored. The handler receives a narrowed event object whose
   * `data` field is typed for the specific event.
   *
   * @example
   * ```ts
   * on: {
   *   'payment.completed': async (event) => {
   *     await db.markPaid(event.data.id);
   *   },
   *   'refund.issued': async (event) => {
   *     await db.recordRefund(event.data.id, event.data.paymentId);
   *   },
   * }
   * ```
   */
  on: WebhookHandlerMap;
}

// ---------------------------------------------------------------------------
// Shared verification + dispatch
// ---------------------------------------------------------------------------

async function verifyAndDispatch(
  rawBody: WebhookPayload,
  signature: string | null | undefined,
  options: WebhookHandlerOptions,
): Promise<'bad_signature' | 'ok' | 'handler_error'> {
  if (!signature) {
    return 'bad_signature';
  }

  let event: FacilPayEvent;
  try {
    event = await constructEvent<FacilPayEvent>(rawBody, signature, options.secret, {
      tolerance: options.tolerance,
      now: options.now,
    });
  } catch (err) {
    if (err instanceof FacilPaySignatureVerificationError) {
      return 'bad_signature';
    }
    throw err;
  }

  const handler = options.on[event.type as WebhookEventType] as
    | WebhookEventHandler<WebhookEventType>
    | undefined;

  if (handler) {
    try {
      await handler(event as never);
    } catch {
      return 'handler_error';
    }
  }

  return 'ok';
}

// ---------------------------------------------------------------------------
// Fetch adapter (Next.js App Router, Hono, Cloudflare Workers, Bun)
// ---------------------------------------------------------------------------

export type FetchWebhookHandler = (request: Request) => Promise<Response>;

/**
 * Build a Fetch-compatible webhook handler for use in Next.js App Router
 * (`route.ts`), Hono, Cloudflare Workers, or any other runtime that deals in
 * standard `Request` / `Response` objects.
 *
 * The handler:
 * - Reads the raw body from the `Request` before any JSON parsing.
 * - Returns `400` when the `X-FacilPay-Signature` header is missing.
 * - Returns `400` when the signature is wrong or the payload was tampered with.
 * - Returns `500` when your handler throws.
 * - Returns `200 { received: true }` on success.
 *
 * @example Next.js App Router (`app/api/webhooks/facilpay/route.ts`):
 * ```ts
 * import { createWebhookHandler } from '@facilpay/sdk';
 *
 * export const runtime = 'nodejs';
 *
 * const handler = createWebhookHandler({
 *   secret: process.env.FACILPAY_WEBHOOK_SECRET!,
 *   on: {
 *     'payment.completed': async (event) => {
 *       await db.markPaid(event.data.id);
 *     },
 *   },
 * });
 *
 * export { handler as POST };
 * ```
 */
export function createWebhookHandler(options: WebhookHandlerOptions): FetchWebhookHandler;

// ---------------------------------------------------------------------------
// Express adapter
// ---------------------------------------------------------------------------

// Minimal typings so the SDK stays dependency-free (no `@types/express`).
export interface ExpressRequest {
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | unknown;
  get(name: string): string | undefined;
}

export interface ExpressResponse {
  sendStatus(code: number): void;
  status(code: number): { json(body: unknown): void };
}

export type NextFunction = (err?: unknown) => void;

export type ExpressWebhookHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

/**
 * Build an Express webhook middleware for use with `express.raw()`.
 *
 * Register the route **before** `express.json()` and add
 * `express.raw({ type: 'application/json' })` as the preceding middleware so
 * the body reaches this handler as a `Buffer`.
 *
 * - Returns `400` on a missing or invalid signature.
 * - Returns `500` when your handler throws.
 * - Returns `200` on success.
 *
 * @example
 * ```ts
 * import { createWebhookHandler } from '@facilpay/sdk';
 * import express from 'express';
 *
 * const webhookHandler = createWebhookHandler.express({
 *   secret: process.env.FACILPAY_WEBHOOK_SECRET!,
 *   on: {
 *     'payment.completed': async (event) => {
 *       console.log('paid', event.data.id);
 *     },
 *   },
 * });
 *
 * app.post(
 *   '/webhooks/facilpay',
 *   express.raw({ type: 'application/json' }),
 *   webhookHandler,
 * );
 * ```
 */
export function createWebhookHandler(options: WebhookHandlerOptions): ExpressWebhookHandler;

// ---------------------------------------------------------------------------
// Overload implementation — returns both adapter types via `.express` property
// ---------------------------------------------------------------------------

export function createWebhookHandler(options: WebhookHandlerOptions): FetchWebhookHandler {
  // Fetch (default) handler
  const fetchHandler: FetchWebhookHandler = async (request: Request): Promise<Response> => {
    const rawBody = await request.text();
    const signature = request.headers.get('x-facilpay-signature');

    const outcome = await verifyAndDispatch(rawBody, signature, options);

    switch (outcome) {
      case 'bad_signature':
        return Response.json({ error: 'Invalid webhook signature.' }, { status: 400 });
      case 'handler_error':
        return Response.json({ error: 'Internal server error.' }, { status: 500 });
      default:
        return Response.json({ received: true }, { status: 200 });
    }
  };

  return fetchHandler;
}

/**
 * Build an Express webhook middleware. Identical options to
 * {@link createWebhookHandler}; the only difference is the calling convention
 * (`req, res, next`).
 */
createWebhookHandler.express = function expressAdapter(
  options: WebhookHandlerOptions,
): ExpressWebhookHandler {
  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction): Promise<void> => {
    // Express with express.raw() delivers the body as a Buffer.
    // Fall back to a string for frameworks that pre-parse it as text.
    let rawBody: WebhookPayload;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      res.status(400).json({ error: 'Raw body unavailable. Add express.raw() before this handler.' });
      return;
    }

    const signature = req.get('x-facilpay-signature') ?? req.get('X-FacilPay-Signature');

    const outcome = await verifyAndDispatch(rawBody, signature, options);

    switch (outcome) {
      case 'bad_signature':
        res.status(400).json({ error: 'Invalid webhook signature.' });
        return;
      case 'handler_error':
        res.status(500).json({ error: 'Internal server error.' });
        return;
      default:
        res.status(200).json({ received: true });
    }
  };
};
