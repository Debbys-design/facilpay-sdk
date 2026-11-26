import type { PagePromise, RequestOptions } from '../types';
import type { Refund } from '../types';
import type { HttpClient } from '../client';

export interface RefundListParams {
  paymentId?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  startingAfter?: string;
}

export class RefundsResource {
  constructor(private readonly http: HttpClient) {}

  list(params?: RefundListParams, options?: RequestOptions): PagePromise<Refund> {
    return this.http.get<Refund>('/v1/refunds', {
      query: params as Record<string, unknown> | undefined,
      ...options,
    });
  }

  retrieve(id: string, options?: RequestOptions): Promise<Refund> {
    return this.http.getOne<Refund>(`/v1/refunds/${id}`, options);
  }
}
