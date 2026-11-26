# Testing & Local Development

This guide covers how to work with FacilPay in test mode, run the local
integration stack, mock the SDK in your own test suite, and debug requests.

## Test keys vs. live keys

FacilPay issues two kinds of API keys:

| Prefix     | Mode   | Where it can be used            |
| ---------- | ------ | ------------------------------- |
| `fp_test_` | Test   | Sandbox only — no real money    |
| `fp_live_` | Live   | Production — real transactions  |

The SDK detects the environment from the key prefix. When you construct the
client with a `fp_test_` key, requests are routed to the sandbox base URL and
the client reports `client.isTestMode === true`. A `fp_live_` key routes to the
production base URL.

```ts
import { FacilPay } from "facilpay";

const client = new FacilPay({ apiKey: process.env.FACILPAY_API_KEY! });

if (client.isTestMode) {
  console.log("Running against the sandbox");
}
```

Never commit real keys. Keep `fp_test_` keys in `.env.local` and load
`fp_live_` keys from your secret manager in production only.

## Integration stack (Docker Compose)

The repository ships a self-contained stack under `test/integration/` that runs
the API, a Postgres database, and a webhook receiver. Use it to exercise the SDK
end-to-end without touching the hosted sandbox.

```bash
cd test/integration
docker compose up --build
```

The stack exposes:

- API at `http://localhost:4010` (use a `fp_test_` key from the seeded fixtures)
- Webhook receiver at `http://localhost:4011`

Point the SDK at it by overriding the base URL:

```ts
const client = new FacilPay({
  apiKey: "fp_test_local",
  baseUrl: "http://localhost:4010",
});
```

Tear the stack down with `docker compose down -v` to drop volumes between runs.

## Mocking the SDK in your app tests

### With MSW

Mock the HTTP layer rather than the SDK itself so your tests exercise real
serialization and error handling.

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.post("https://api.facilpay.test/v1/charges", () =>
    HttpResponse.json({ id: "ch_test_123", status: "succeeded" }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### With a custom `fetch`

The client accepts a `fetch` implementation, which is handy for lightweight
unit tests:

```ts
const client = new FacilPay({
  apiKey: "fp_test_123",
  fetch: async () =>
    new Response(JSON.stringify({ id: "ch_test_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
});
```

## Triggering test webhooks

Use `webhooks.sendTest()` to deliver a synthetic event to a registered endpoint
in test mode. This is the fastest way to verify your handler without creating a
real charge.

```ts
await client.webhooks.sendTest({
  event: "charge.succeeded",
  endpointId: "we_test_123",
});
```

Test deliveries are signed with the same scheme as live webhooks, so your
signature-verification code runs unchanged.

## Debug logging

Set `FACILPAY_LOG=debug` to emit request/response logs to stderr:

```bash
FACILPAY_LOG=debug node ./scripts/smoke.js
```

Debug output includes the HTTP method, URL, status, and timing. Sensitive
values are redacted before logging:

- `Authorization` headers are replaced with `Bearer [REDACTED]`
- Request and response bodies have `card`, `cvc`, `apiKey`, and `secret` fields
  masked
- Query-string values for `key` and `token` are masked

Never enable debug logging in production; use it only for local development and
CI troubleshooting.
