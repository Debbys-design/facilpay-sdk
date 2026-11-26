import { createWebhookHandler } from '@facilpay/sdk';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/facilpay
 *
 * FacilPay delivers signed webhook events here. createWebhookHandler reads
 * the raw body, verifies the HMAC signature, and dispatches to the matching
 * handler — returning 400 on a bad signature and 500 if a handler throws.
 */
export const POST = createWebhookHandler({
  secret: process.env.FACILPAY_WEBHOOK_SECRET!,
  on: {
    'payment.completed': async (event) => {
      // event.data is typed as Payment — no cast needed.
      console.log('Payment completed:', event.data.id, event.data.amount, event.data.currency);
    },
    'refund.issued': async (event) => {
      console.log('Refund issued:', event.data.id, 'for payment', event.data.paymentId);
    },
  },
});
