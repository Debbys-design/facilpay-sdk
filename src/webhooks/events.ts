import type { Dispute } from '../resources/disputes';
import type { StellarTransaction } from '../resources/stellar';
import type { Payment, Refund } from '../types';

/** A Stellar multisig transaction payload delivered via webhook. */
export type MultisigTransaction = StellarTransaction;

/**
 * The delivery envelope sent by facilpay-api for every webhook delivery.
 *
 * Field names verified against a real delivery captured from facilpay-api:
 * {
 *   "id": "evt_01H...",
 *   "type": "payment.completed",
 *   "timestamp": "2024-05-01T12:34:56.789Z",
 *   "data": { ... }
 * }
 */
export interface WebhookEnvelope<TType extends string, TData> {
  /** Unique id of the delivery, e.g. `evt_01H...`. */
  id: string;
  /** Event type discriminator. */
  type: TType;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Event-specific payload. */
  data: TData;
}

/**
 * Source-of-truth webhook event catalog, aligned with facilpay-api.
 *
 * Every event name that an endpoint can subscribe to lives here. Both
 * {@link WebhookEventType} and `CreateWebhookParams.events` derive from this
 * map, so subscribing to an event and typing a delivery can never drift apart.
 */
export interface WebhookEventCatalog {
  'payment.created': Payment;
  'payment.completed': Payment;
  'payment.failed': Payment;
  'payment.expired': Payment;
  'payment.split_processed': Payment;
  'payment_link.created': PaymentLink;
  'payment_link.paid': PaymentLink;
  'payment_link.expired': PaymentLink;
  'refund.issued': Refund;
  'dispute.opened': Dispute;
  'dispute.updated': Dispute;
  'dispute.closed': Dispute;
  'recurring_payment.created': RecurringPayment;
  'recurring_payment.charged': RecurringPayment;
  'recurring_payment.failed': RecurringPayment;
  'recurring_payment.cancelled': RecurringPayment;
  'transaction.multisig_required': MultisigTransaction;
  'transaction.multisig_completed': MultisigTransaction;
  test: TestEventData;
}

/** All supported webhook event type literals, derived from the catalog. */
export type WebhookEventType = keyof WebhookEventCatalog;

/** Synthetic event used by facilpay-api to validate an endpoint. */
export interface TestEventData {
  message: string;
}

/** A payment link payload delivered via webhook. */
export interface PaymentLink {
  id: string;
  url: string;
  amount: string;
  asset: string;
  status: 'active' | 'paid' | 'expired';
  createdAt: string;
  expiresAt?: string;
}

/** A recurring payment schedule payload delivered via webhook. */
export interface RecurringPayment {
  id: string;
  paymentId: string;
  amount: string;
  asset: string;
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  nextChargeAt?: string;
  createdAt: string;
}

export type PaymentCreatedEvent = WebhookEnvelope<'payment.created', Payment>;
export type PaymentCompletedEvent = WebhookEnvelope<'payment.completed', Payment>;
export type PaymentFailedEvent = WebhookEnvelope<'payment.failed', Payment>;
export type PaymentExpiredEvent = WebhookEnvelope<'payment.expired', Payment>;
export type PaymentSplitProcessedEvent = WebhookEnvelope<'payment.split_processed', Payment>;
export type PaymentLinkCreatedEvent = WebhookEnvelope<'payment_link.created', PaymentLink>;
export type PaymentLinkPaidEvent = WebhookEnvelope<'payment_link.paid', PaymentLink>;
export type PaymentLinkExpiredEvent = WebhookEnvelope<'payment_link.expired', PaymentLink>;
export type RefundIssuedEvent = WebhookEnvelope<'refund.issued', Refund>;
export type DisputeOpenedEvent = WebhookEnvelope<'dispute.opened', Dispute>;
export type DisputeUpdatedEvent = WebhookEnvelope<'dispute.updated', Dispute>;
export type DisputeClosedEvent = WebhookEnvelope<'dispute.closed', Dispute>;
export type RecurringPaymentCreatedEvent = WebhookEnvelope<
  'recurring_payment.created',
  RecurringPayment
>;
export type RecurringPaymentChargedEvent = WebhookEnvelope<
  'recurring_payment.charged',
  RecurringPayment
>;
export type RecurringPaymentFailedEvent = WebhookEnvelope<
  'recurring_payment.failed',
  RecurringPayment
>;
export type RecurringPaymentCancelledEvent = WebhookEnvelope<
  'recurring_payment.cancelled',
  RecurringPayment
>;
export type TransactionMultisigRequiredEvent = WebhookEnvelope<
  'transaction.multisig_required',
  MultisigTransaction
>;
export type TransactionMultisigCompletedEvent = WebhookEnvelope<
  'transaction.multisig_completed',
  MultisigTransaction
>;
export type TestEvent = WebhookEnvelope<'test', TestEventData>;

/**
 * Discriminated union of every webhook event, keyed on `type`.
 *
 * `switch (event.type)` narrows `event.data` automatically.
 */
export type FacilPayEvent =
  | PaymentCreatedEvent
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | PaymentExpiredEvent
  | PaymentSplitProcessedEvent
  | PaymentLinkCreatedEvent
  | PaymentLinkPaidEvent
  | PaymentLinkExpiredEvent
  | RefundIssuedEvent
  | DisputeOpenedEvent
  | DisputeUpdatedEvent
  | DisputeClosedEvent
  | RecurringPaymentCreatedEvent
  | RecurringPaymentChargedEvent
  | RecurringPaymentFailedEvent
  | RecurringPaymentCancelledEvent
  | TransactionMultisigRequiredEvent
  | TransactionMultisigCompletedEvent
  | TestEvent;

/**
 * Legacy event names that were previously accepted by `WebhookEvent`.
 *
 * @deprecated Use the canonical catalog names instead:
 * - `payment.completed` -> `payment.completed`
 * - `payment.refunded` -> `refund.issued`
 * - `dispute.created` -> `dispute.opened`
 */
export type DeprecatedWebhookEventType =
  | 'payment.refunded'
  | 'dispute.created';

/**
 * Type guard narrowing a {@link FacilPayEvent} to a specific event type.
 *
 * ```ts
 * if (isEventType(event, 'refund.issued')) {
 *   event.data.paymentId; // narrowed
 * }
 * ```
 */
export function isEventType<TType extends WebhookEventType>(
  event: FacilPayEvent,
  type: TType,
): event is Extract<FacilPayEvent, { type: TType }> {
  return event.type === type;
}
