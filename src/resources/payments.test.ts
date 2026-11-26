import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentsResource } from './payments';
import { FacilPayValidationError } from '../core/errors';
import type { HttpClient } from '../core/http';

describe('PaymentsResource', () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let http: HttpClient;
  let payments: PaymentsResource;

  beforeEach(() => {
    requestMock = vi.fn().mockResolvedValue({ id: 'pay_123' });
    http = { request: requestMock } as unknown as HttpClient;
    payments = new PaymentsResource(http);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieve hits the expected endpoint', async () => {
    await payments.retrieve('pay_123');

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, path] = requestMock.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toBe('/payments/pay_123');
  });

  it('cancel hits the expected endpoint', async () => {
    await payments.cancel('pay_123');

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, path] = requestMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/payments/pay_123/cancel');
  });
});

describe('FacilPayValidationError', () => {
  it('has the expected name, code and instanceof chain', () => {
    const error = new FacilPayValidationError('invalid input');

    expect(error).toBeInstanceOf(FacilPayValidationError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FacilPayValidationError');
    expect(error.code).toBe('validation_error');
    expect(error.message).toBe('invalid input');
  });
});
