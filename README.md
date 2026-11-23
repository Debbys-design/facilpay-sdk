<p align="center">
  <img src="https://raw.githubusercontent.com/Facil-Pay/facilpay-frontend/main/app/branding/logo/horizontal/facilpay-horizontal-logo.png" alt="FacilPay" width="320" />
</p>

<h1 align="center">FacilPay SDK</h1>

<p align="center">
  Easily integrate crypto payments into your app.<br/>
  The official TypeScript/JavaScript SDK for the <a href="https://github.com/Facil-Pay/facilpay-api">FacilPay API</a> and the FacilPay <a href="https://github.com/Facil-Pay/facilpay-contracts">Soroban smart contracts</a> on Stellar.
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-pre--release-orange" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933" />
</p>

> [!WARNING]
> The SDK is under active development and has not been published to npm yet. The API shown below is the target design and may change before `1.0.0`. See the [open issues](https://github.com/Facil-Pay/facilpay-sdk/issues) for the roadmap and to pick something to work on.

> [!NOTE]
> This README is kept in sync with the code in `src/`. Features that are documented but not yet implemented are explicitly marked **planned** and link to their tracking issue. If a sample below is not marked *planned*, it reflects the current exported surface.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Payments](#payments)
  - [Payment Links](#payment-links)
  - [Refunds](#refunds)
  - [Disputes](#disputes)
  - [Fees](#fees)
  - [Recurring Payments](#recurring-payments)
  - [Webhooks](#webhooks)
  - [Settlements, Rates & Currencies](#settlements-rates--currencies)
  - [On-chain Contracts (Soroban)](#on-chain-contracts-soroban)
- [Error Handling](#error-handling)
- [Idempotency & Retries](#idempotency--retries)
- [Pagination](#pagination)
- [Test Mode](#test-mode)
- [Framework Integrations](#framework-integrations)
- [Project Structure](#project-structure)
- [Development](#development)
- [Contributing](#contributing)
- [Related Repositories](#related-repositories)
- [License](#license)

---

## Overview

FacilPay is a Stellar-based payment gateway that lets merchants accept crypto payments and settle in stablecoins (USDC). The platform has three parts:

| Layer       | Repository                                                            | Stack                      |
| ----------- | --------------------------------------------------------------------- | -------------------------- |
| Contracts   | [facilpay-contracts](https://github.com/Facil-Pay/facilpay-contracts) | Rust, Soroban (Stellar)    |
| Backend API | [facilpay-api](https://github.com/Facil-Pay/facilpay-api)             | NestJS, PostgreSQL, BullMQ |
| Dashboard   | [facilpay-frontend](https://github.com/Facil-Pay/facilpay-frontend)   | Next.js, React, Tailwind   |
| **SDK**     | **facilpay-sdk** (this repo)                                          | **TypeScript**             |

The SDK wraps all of this in one typed client, so you don't have to write HTTP calls, sign webhooks or build Soroban transactions yourself.

```text
┌──────────────────┐        HTTPS (/v1)         ┌──────────────────┐     Soroban RPC     ┌──────────────────────┐
│   Your app       │ ─────────────────────────▶ │  facilpay-api    │ ──────────────────▶ │  payment / escrow /  │
│  + facilpay-sdk  │ ◀───── signed webhooks ─── │  (NestJS)        │                     │  refund / admin      │
└──────────────────┘                            └──────────────────┘                     └──────────────────────┘
         │                                                                                          ▲
         └────────────────────────── optional direct contract calls (@facilpay/sdk/contracts) ──────┘
```

## Features

- **Typed REST client** for the public `/v1` resources that are currently wired up in `src/`: payments, payment links, refunds, disputes, merchant fees, recurring payments, webhooks, API keys and Stellar balances.
- **API key authentication** with `fp_test_…` / `fp_live_…` keys and automatic environment detection.
- **Automatic idempotency keys** on payment creation, so a retried request never charges twice.
- **Webhook signature verification** (HMAC-SHA256, constant-time comparison) plus typed event payloads.
- **Typed errors** (`FacilPayAuthenticationError`, `FacilPayRateLimitError`, …) carrying the request ID.
- **Soroban contract bindings** for the `payment`, `escrow` and `refund` contracts, for apps that talk to the chain directly.
- **Runs anywhere**: Node.js 18+, Bun, Deno, edge runtimes and the browser (publishable-key features only). Uses native `fetch`.
- **Tree-shakeable ESM + CJS builds** with bundled type declarations.

**Planned** (not yet implemented — see the linked tracking issues):

- **Retries with exponential backoff** for network errors, `429` and `5xx` responses — [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71).
- **Auto-pagination** helpers for list endpoints — [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71).
- **Settlements, rates and currencies** resources — [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71).

## Installation

```bash
npm install @facilpay/sdk
# or
yarn add @facilpay/sdk
# or
pnpm add @facilpay/sdk
```

## Quick Start

```ts
import { FacilPay } from '@facilpay/sdk';

const facilpay = new FacilPay({
  apiKey: process.env.FACILPAY_API_KEY!, // fp_test_... or fp_live_...
});

// Create a payment
const payment = await facilpay.payments.create({
  amount: 49.99,
  currency: 'USD',
  description: 'Order #12345',
  payerEmail: 'customer@example.com',
  metadata: { orderId: 'order_12345' },
  expiresIn: 1800, // seconds
});

console.log(payment.id, payment.status); // "…", "PENDING"

// Get a QR code the customer can scan with a Stellar wallet
const qr = await facilpay.payments.getQrCode(payment.id);
```

## Authentication

Create API keys in the FacilPay dashboard or through `POST /v1/api-keys`. Keys come in two environments:

| Prefix     | Environment | Moves real funds |
| ---------- | ----------- | ---------------- |
| `fp_test_` | Testnet     | No               |
| `fp_live_` | Mainnet     | Yes              |

The SDK sends the key as `Authorization: ApiKey <key>`. Never ship a secret key to a browser or mobile app. Keep it on your server.

```ts
const facilpay = new FacilPay({ apiKey: process.env.FACILPAY_API_KEY! });
```

## Configuration

```ts
const facilpay = new FacilPay({
  apiKey: 'fp_test_...',
  baseUrl: 'https://api.facilpay.io', // override for self-hosted or local (http://localhost:3000)
  timeout: 30_000, // per-request timeout in ms
  fetch: customFetch, // bring your own fetch implementation
  headers: { 'X-Correlation-Id': 'checkout-service' },
  logger: console, // optional debug logging (API keys are redacted)
});
```

| Option       | Type                     | Default                   | Description                                     |
| ------------ | ------------------------ | ------------------------- | ----------------------------------------------- |
| `apiKey`     | `string`                 | —                         | **Required.** Your `fp_test_` or `fp_live_` key |
| `baseUrl`    | `string`                 | `https://api.facilpay.io` | API origin. `/v1` is appended automatically     |
| `timeout`    | `number`                 | `30000`                   | Request timeout in milliseconds                 |
| `fetch`      | `typeof fetch`           | `globalThis.fetch`        | Custom fetch implementation                     |
| `headers`    | `Record<string, string>` | `{}`                      | Extra headers sent with every request           |
| `logger`     | `Logger`                 | `undefined`               | Receives request/response debug logs            |

> [!NOTE]
> `maxRetries` is **planned** and not yet part of the `FacilPay` constructor options — see [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71).

See [docs/configuration.md](docs/configuration.md) for the full reference, including environment variables, custom `fetch` for proxies and edge runtimes.

## Usage

### Payments

```ts
// Create (an Idempotency-Key is generated for you; pass your own to control retries)
const payment = await facilpay.payments.create({
  amount: 49.99,
  currency: 'USD',
  description: 'Order #12345',
  payerEmail: 'customer@example.com',
  metadata: { orderId: 'order_12345' },
  expiresIn: 1800,
});

// Retrieve a single payment
const fetched = await facilpay.payments.retrieve(payment.id);

// Get a QR code the customer can scan with a Stellar wallet
const qr = await facilpay.payments.getQrCode(payment.id);
```

> [!NOTE]
> `payments.list` and `payments.retrieve` are **planned** and not yet exported by the SDK — see [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71). The `payments.create` and `payments.getQrCode` calls above reflect the current surface.

### Payment Links

```ts
const link = await facilpay.paymentLinks.create({
  amount: 49.99,
  currency: 'USD',
  description: 'Order #12345',
});

console.log(link.url);
```

### Refunds

```ts
const refund = await facilpay.refunds.create({
  paymentId: payment.id,
  amount: 49.99,
  reason: 'Customer request',
});
```

### Disputes

```ts
const dispute = await facilpay.disputes.retrieve(disputeId);
```

### Fees

```ts
const fees = await facilpay.fees.retrieve();
```

### Recurring Payments

```ts
const subscription = await facilpay.recurring.create({
  amount: 9.99,
  currency: 'USD',
  interval: 'month',
  payerEmail: 'customer@example.com',
});
```

### Webhooks

```ts
import { verifyWebhookSignature } from '@facilpay/sdk';

const isValid = verifyWebhookSignature({
  payload: rawBody,
  signature: req.headers['facilpay-signature'],
  secret: process.env.FACILPAY_WEBHOOK_SECRET!,
});
```

### Settlements, Rates & Currencies

> [!NOTE]
> The `settlements`, `rates` and `currencies` resources are **planned** and not yet implemented in `src/` — see [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71). The examples below describe the intended API and will not run against the current release.

```ts
// Planned — not yet available
const settlements = await facilpay.settlements.list();
const rate = await facilpay.rates.retrieve({ from: 'USD', to: 'USDC' });
const currencies = await facilpay.currencies.list();
```

### On-chain Contracts (Soroban)

```ts
import { PaymentContract } from '@facilpay/sdk/contracts';

const contract = new PaymentContract({ /* … */ });
```

## Error Handling

```ts
import {
  FacilPayAuthenticationError,
  FacilPayRateLimitError,
} from '@facilpay/sdk';

try {
  await facilpay.payments.create({ /* … */ });
} catch (err) {
  if (err instanceof FacilPayAuthenticationError) {
    // bad or missing API key
  } else if (err instanceof FacilPayRateLimitError) {
    // back off and retry
  }
}
```

## Idempotency & Retries

Payment creation automatically sends an `Idempotency-Key` header. Pass your own to control retries:

```ts
await facilpay.payments.create(
  { amount: 49.99, currency: 'USD' },
  { idempotencyKey: 'order_12345' },
);
```

> [!NOTE]
> Automatic retries with exponential backoff are **planned** and not yet implemented — see [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71).

## Pagination

> [!NOTE]
> Auto-pagination helpers are **planned** and not yet implemented — see [#71](https://github.com/Facil-Pay/facilpay-sdk/issues/71). List endpoints currently return a single page.

## Test Mode

Use an `fp_test_` key to hit the Stellar testnet. No real funds move.

## Framework Integrations

See [docs/](docs/) for framework-specific guides.

## Project Structure

```text
src/
  client.ts        # FacilPay client
  resources/       # REST resource wrappers
  index.ts         # public exports
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/testing.md](docs/testing.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Related Repositories

- [facilpay-api](https://github.com/Facil-Pay/facilpay-api)
- [facilpay-contracts](https://github.com/Facil-Pay/facilpay-contracts)
- [facilpay-frontend](https://github.com/Facil-Pay/facilpay-frontend)

## License

MIT
