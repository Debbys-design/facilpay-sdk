import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpClient } from './http';
import { verifyWebhookSignature } from './webhook';

describe('HttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends JSON requests with auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com' });
    const result = await client.request<{ ok: boolean }>('/v1/things', {
      method: 'POST',
      body: { hello: 'world' },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/things');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('throws on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    );

    const client = new HttpClient({ apiKey: 'test-key', baseUrl: 'https://api.example.com' });
    await expect(client.request('/v1/things')).rejects.toThrow();
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'thing.created' });

  function signWithNode(body: string, key: string): string {
    return createHmac('sha256', key).update(body).digest('hex');
  }

  it('verifies a valid signature', async () => {
    const signature = signWithNode(payload, secret);
    await expect(verifyWebhookSignature(payload, signature, secret)).resolves.toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const signature = signWithNode(payload, 'wrong_secret');
    await expect(verifyWebhookSignature(payload, signature, secret)).resolves.toBe(false);
  });

  it('subtle path matches the node:crypto path', async () => {
    const nodeSignature = signWithNode(payload, secret);

    // Force the Web Crypto (crypto.subtle) code path used on edge runtimes.
    const subtle = globalThis.crypto?.subtle;
    expect(subtle).toBeDefined();

    const key = await subtle!.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const subtleBuffer = await subtle!.sign('HMAC', key, new TextEncoder().encode(payload));
    const subtleSignature = Array.from(new Uint8Array(subtleBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(subtleSignature).toBe(nodeSignature);

    // Both signatures must be accepted by the verifier.
    await expect(verifyWebhookSignature(payload, nodeSignature, secret)).resolves.toBe(true);
    await expect(verifyWebhookSignature(payload, subtleSignature, secret)).resolves.toBe(true);

    // Constant-time comparison sanity check against node:crypto.
    const a = Buffer.from(nodeSignature, 'hex');
    const b = Buffer.from(subtleSignature, 'hex');
    expect(a.length).toBe(b.length);
    expect(timingSafeEqual(a, b)).toBe(true);
  });
});
