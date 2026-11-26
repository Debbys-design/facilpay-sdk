import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhooksResource } from './webhooks';
import type { HttpClient } from '../core/http';

function createMockHttp() {
  return {
    request: vi.fn(async () => ({ data: {}, status: 200, headers: new Headers() })),
  } as unknown as HttpClient & { request: ReturnType<typeof vi.fn> };
}

async function subtleHmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('WebhooksResource', () => {
  let http: ReturnType<typeof createMockHttp>;
  let webhooks: WebhooksResource;

  beforeEach(() => {
    http = createMockHttp();
    webhooks = new WebhooksResource(http);
  });

  it('create posts to /v1/webhooks', async () => {
    const params = { url: 'https://example.com/hook', events: ['payment.succeeded' as const] };
    await webhooks.create({ url: params.url, events: [...params.events] });
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks',
      body: { url: params.url, events: [...params.events] },
    });
  });

  it('list gets /v1/webhooks', async () => {
    await webhooks.list();
    expect(http.request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/webhooks' });
  });

  it('retrieve gets /v1/webhooks/:id', async () => {
    await webhooks.retrieve('wh_123');
    expect(http.request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/webhooks/wh_123' });
  });

  it('listDeliveries gets /v1/webhooks/:id/deliveries with params', async () => {
    await webhooks.listDeliveries('wh_123', { page: 2, limit: 10 });
    expect(http.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/webhooks/wh_123/deliveries',
      query: { page: 2, limit: 10 },
    });
  });

  it('listDeliveries forwards status, eventType and since filters', async () => {
    await webhooks.listDeliveries('wh_123', {
      status: 'failed',
      eventType: 'payment.succeeded',
      since: '2024-01-01T00:00:00Z',
    });
    expect(http.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/webhooks/wh_123/deliveries',
      query: {
        status: 'failed',
        eventType: 'payment.succeeded',
        since: '2024-01-01T00:00:00Z',
      },
    });
  });

  it('listDeliveries returns a PagePromise', async () => {
    const result = webhooks.listDeliveries('wh_123', { status: 'failed' });
    expect(typeof result.then).toBe('function');
    expect(typeof result.next).toBe('function');
    await result;
  });

  it('retryFailedDeliveries posts to /v1/webhooks/:id/deliveries/retry-failed', async () => {
    await webhooks.retryFailedDeliveries('wh_123', { since: '2024-01-01T00:00:00Z' });
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks/wh_123/deliveries/retry-failed',
      body: { since: '2024-01-01T00:00:00Z' },
    });
  });

  it('retryFailedDeliveries works without a since filter', async () => {
    await webhooks.retryFailedDeliveries('wh_123');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks/wh_123/deliveries/retry-failed',
      body: {},
    });
  });

  it('update patches /v1/webhooks/:id', async () => {
    const params = { url: 'https://example.com/hook', isActive: false };
    await webhooks.update('wh_123', params);
    expect(http.request).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/v1/webhooks/wh_123',
      body: params,
    });
  });

  it('delete deletes /v1/webhooks/:id', async () => {
    await webhooks.delete('wh_123');
    expect(http.request).toHaveBeenCalledWith({ method: 'DELETE', path: '/v1/webhooks/wh_123' });
  });

  it('sendTest posts to /v1/webhooks/:id/test', async () => {
    await webhooks.sendTest('wh_123');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks/wh_123/test',
      body: {},
    });
  });

  it('rotateSecret posts to /v1/webhooks/:id/rotate-secret', async () => {
    await webhooks.rotateSecret('wh_123');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks/wh_123/rotate-secret',
      body: {},
    });
  });

  it('retryDelivery posts to /v1/webhooks/deliveries/:deliveryId/retry', async () => {
    await webhooks.retryDelivery('dlv_123');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/webhooks/deliveries/dlv_123/retry',
      body: {},
    });
  });

  it('forwards request options (e.g. signal) on retrieve and listDeliveries', async () => {
    const controller = new AbortController();
    await webhooks.retrieve('wh_123', { signal: controller.signal, timeout: 1000 });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, timeout: 1000 }),
    );
    await webhooks.listDeliveries('wh_123', undefined, { signal: controller.signal });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('crypto.subtle HMAC-SHA256 matches node:crypto for webhook verification', async () => {
    const secret = 'whsec_test_secret';
    const payload = JSON.stringify({ id: 'evt_123', type: 'payment.succeeded' });

    const nodeSignature = createHmac('sha256', secret).update(payload).digest('hex');
    const subtleSignature = await subtleHmacHex(secret, payload);

    expect(subtleSignature).toBe(nodeSignature);
  });
});
