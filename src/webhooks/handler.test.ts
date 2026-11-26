import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createWebhookHandler } from './handler';
import { generateTestHeader } from './verify';
import type { FacilPayEvent, PaymentCompletedEvent, RefundIssuedEvent } from './events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'whsec_test_handler_secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makeEvent<T extends FacilPayEvent>(partial: T): string {
  return JSON.stringify(partial);
}

const PAYMENT_COMPLETED_BODY = makeEvent<PaymentCompletedEvent>({
  id: 'evt_001',
  type: 'payment.completed',
  timestamp: '2024-01-01T00:00:00.000Z',
  data: {
    id: 'pay_001',
    amount: 19.99,
    currency: 'USD',
    status: 'completed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
});

const REFUND_ISSUED_BODY = makeEvent<RefundIssuedEvent>({
  id: 'evt_002',
  type: 'refund.issued',
  timestamp: '2024-01-01T00:00:00.000Z',
  data: {
    id: 'ref_001',
    paymentId: 'pay_001',
    amount: 10,
    currency: 'USD',
    status: 'issued',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
});

// Make node:crypto available in the test environment.
beforeEach(() => {
  vi.stubGlobal('require', createRequire(import.meta.url));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fetch adapter (createWebhookHandler)
// ---------------------------------------------------------------------------

describe('createWebhookHandler — Fetch adapter', () => {
  it('returns 200 and calls the matching handler', async () => {
    const onCompleted = vi.fn();

    const handler = createWebhookHandler({
      secret: SECRET,
      on: { 'payment.completed': onCompleted },
    });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': sign(PAYMENT_COMPLETED_BODY) },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(onCompleted).toHaveBeenCalledOnce();
    const [calledWith] = onCompleted.mock.calls[0] as [PaymentCompletedEvent];
    expect(calledWith.data.id).toBe('pay_001');
  });

  it('calls only the registered handler, skips unregistered types', async () => {
    const onRefund = vi.fn();
    const onCompleted = vi.fn();

    const handler = createWebhookHandler({
      secret: SECRET,
      // only 'refund.issued' is registered
      on: { 'refund.issued': onRefund },
    });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': sign(PAYMENT_COMPLETED_BODY) },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(onRefund).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature header is missing', async () => {
    const handler = createWebhookHandler({ secret: SECRET, on: {} });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      // no x-facilpay-signature header
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the signature is wrong', async () => {
    const handler = createWebhookHandler({ secret: SECRET, on: {} });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': sign(PAYMENT_COMPLETED_BODY, 'wrong_secret') },
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the payload is tampered', async () => {
    const handler = createWebhookHandler({ secret: SECRET, on: {} });
    const originalSig = sign(PAYMENT_COMPLETED_BODY);
    const tampered = PAYMENT_COMPLETED_BODY.replace('pay_001', 'pay_EVIL');

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: tampered,
      headers: { 'x-facilpay-signature': originalSig },
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 when the handler throws', async () => {
    const handler = createWebhookHandler({
      secret: SECRET,
      on: {
        'payment.completed': async () => {
          throw new Error('DB write failed');
        },
      },
    });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': sign(PAYMENT_COMPLETED_BODY) },
    });

    const res = await handler(req);
    expect(res.status).toBe(500);
  });

  it('supports multiple secrets for key rotation', async () => {
    const OLD_SECRET = 'whsec_old_secret';
    const handler = createWebhookHandler({
      secret: [SECRET, OLD_SECRET],
      on: {},
    });

    // Signed with the old secret — should still pass during rotation window.
    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': sign(PAYMENT_COMPLETED_BODY, OLD_SECRET) },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  it('dispatches the refund.issued handler with the correct data shape', async () => {
    const onRefund = vi.fn();

    const handler = createWebhookHandler({
      secret: SECRET,
      on: { 'refund.issued': onRefund },
    });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: REFUND_ISSUED_BODY,
      headers: { 'x-facilpay-signature': sign(REFUND_ISSUED_BODY) },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(onRefund).toHaveBeenCalledOnce();
    const [calledWith] = onRefund.mock.calls[0] as [RefundIssuedEvent];
    expect(calledWith.data.paymentId).toBe('pay_001');
    expect(calledWith.data.amount).toBe(10);
  });

  it('uses generateTestHeader to sign the payload (integration)', async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, on: { 'payment.completed': onCompleted } });

    const req = new Request('https://example.com/webhooks', {
      method: 'POST',
      body: PAYMENT_COMPLETED_BODY,
      headers: { 'x-facilpay-signature': generateTestHeader(PAYMENT_COMPLETED_BODY, SECRET) },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(onCompleted).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Express adapter (createWebhookHandler.express)
// ---------------------------------------------------------------------------

function makeExpressContext(body: string | Buffer, signature?: string) {
  const statusMock = vi.fn().mockReturnValue({ json: vi.fn() });
  const req = {
    body,
    headers: signature ? { 'x-facilpay-signature': signature } : {},
    get: (name: string) => {
      const lower = name.toLowerCase();
      return lower === 'x-facilpay-signature' ? signature : undefined;
    },
  };
  const res = {
    sendStatus: vi.fn(),
    status: statusMock,
  };
  const next = vi.fn();
  return { req, res, next, statusMock };
}

describe('createWebhookHandler.express — Express adapter', () => {
  it('calls res.status(200) and the handler on a valid request', async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler.express({ secret: SECRET, on: { 'payment.completed': onCompleted } });

    const { req, res, next } = makeExpressContext(
      Buffer.from(PAYMENT_COMPLETED_BODY),
      sign(PAYMENT_COMPLETED_BODY),
    );

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature header is missing', async () => {
    const handler = createWebhookHandler.express({ secret: SECRET, on: {} });
    const { req, res, next } = makeExpressContext(Buffer.from(PAYMENT_COMPLETED_BODY));

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature is wrong', async () => {
    const handler = createWebhookHandler.express({ secret: SECRET, on: {} });
    const { req, res, next } = makeExpressContext(
      Buffer.from(PAYMENT_COMPLETED_BODY),
      sign(PAYMENT_COMPLETED_BODY, 'wrong'),
    );

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when the body is not a Buffer (json middleware ran first)', async () => {
    const handler = createWebhookHandler.express({ secret: SECRET, on: {} });
    const { req, res, next } = makeExpressContext(
      { type: 'already_parsed' } as unknown as Buffer,
      sign(PAYMENT_COMPLETED_BODY),
    );

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a string body (non-Express frameworks)', async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler.express({ secret: SECRET, on: { 'payment.completed': onCompleted } });
    const { req, res, next } = makeExpressContext(
      PAYMENT_COMPLETED_BODY,
      sign(PAYMENT_COMPLETED_BODY),
    );

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('returns 500 when the handler throws', async () => {
    const handler = createWebhookHandler.express({
      secret: SECRET,
      on: {
        'payment.completed': async () => {
          throw new Error('oops');
        },
      },
    });

    const { req, res, next } = makeExpressContext(
      Buffer.from(PAYMENT_COMPLETED_BODY),
      sign(PAYMENT_COMPLETED_BODY),
    );

    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Type-level assertions (compile-time only)
// ---------------------------------------------------------------------------

describe('type safety', () => {
  it('compiles: handler receives narrowed event type', () => {
    // This test exists only to verify the types compile; there is no runtime assertion.
    createWebhookHandler({
      secret: SECRET,
      on: {
        'payment.completed': (event) => {
          // event.data should be Payment
          const _id: string = event.data.id;
          const _amount: number = event.data.amount;
          void _id;
          void _amount;
        },
        'refund.issued': (event) => {
          const _pid: string = event.data.paymentId;
          void _pid;
        },
        test: (event) => {
          const _msg: string = event.data.message;
          void _msg;
        },
      },
    });
  });
});
