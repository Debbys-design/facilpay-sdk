import { HttpClient, type HttpClientOptions } from './core/http';

export interface FacilPayOptions extends HttpClientOptions {}

export class FacilPay {
  readonly http: HttpClient;

  constructor(options: FacilPayOptions = {}) {
    this.http = new HttpClient(options);
  }

  request<T>(options: Parameters<HttpClient['request']>[0]): Promise<T> {
    return this.http.request<T>(options);
  }
}
