import {
  Account,
  Address,
  Contract,
  Networks,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import { FacilPayContractError, type FacilPayNetwork, type SubmitResult } from './payment';

/**
 * FacilPay refund contract bindings.
 *
 * This module lives behind the `@facilpay/sdk/contracts` entry point so that
 * REST-only consumers of `@facilpay/sdk` never pull in `@stellar/stellar-sdk`.
 *
 * Amounts are represented as `bigint` (Soroban `i128`). FacilPay tokens use
 * 7 decimals of precision, so `1_0000000n` equals `1.0` token.
 */

/** Reason codes for a refund request, matching the on-chain contract. */
export enum RefundReasonCode {
  CustomerRequest = 0,
  DuplicatePayment = 1,
  Fraudulent = 2,
  ServiceNotRendered = 3,
  Other = 4,
}

export interface RefundContractOptions {
  /** Deployed refund contract id (C...). */
  contractId: string;
  /** Target network. */
  network: FacilPayNetwork;
  /** Soroban RPC endpoint. */
  rpcUrl: string;
  /** Optional network passphrase override (defaults derived from `network`). */
  networkPassphrase?: string;
}

export interface Refund {
  id: bigint;
  paymentId: bigint;
  customer: string;
  merchant: string;
  token: string;
  amount: bigint;
  reason: RefundReasonCode;
  status: string;
  createdAt: bigint;
}

export interface RequestRefundParams {
  paymentId: bigint;
  customer: string;
  amount: bigint;
  reason: RefundReasonCode;
}

export interface ApproveRefundParams {
  refundId: bigint;
  merchant: string;
}

export interface RejectRefundParams {
  refundId: bigint;
  merchant: string;
}

const NETWORK_PASSPHRASES: Record<FacilPayNetwork, string> = {
  mainnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  local: Networks.STANDALONE,
};

function toI128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

function decodeRefund(raw: unknown): Refund {
  const value = raw as Record<string, unknown>;
  return {
    id: BigInt(value.id as bigint),
    paymentId: BigInt(value.payment_id as bigint),
    customer: String(value.customer),
    merchant: String(value.merchant),
    token: String(value.token),
    amount: BigInt(value.amount as bigint),
    reason: Number(value.reason) as RefundReasonCode,
    status: String(value.status),
    createdAt: BigInt(value.created_at as bigint),
  };
}

/**
 * Ergonomic wrapper around the FacilPay refund contract.
 *
 * Customer/merchant-facing methods return an unsigned, assembled transaction
 * for the user's wallet to sign; read-only methods simulate and return decoded
 * values.
 */
export class RefundContract {
  readonly contractId: string;
  readonly network: FacilPayNetwork;
  readonly rpcUrl: string;
  readonly networkPassphrase: string;

  private readonly server: SorobanRpc.Server;
  private readonly contract: Contract;

  constructor(options: RefundContractOptions) {
    this.contractId = options.contractId;
    this.network = options.network;
    this.rpcUrl = options.rpcUrl;
    this.networkPassphrase = options.networkPassphrase ?? NETWORK_PASSPHRASES[options.network];
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
  }

  /** Builds an unsigned transaction for a contract call. */
  private async buildUnsigned(
    source: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<Transaction> {
    const account = await this.server.getAccount(source);
    return new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
  }

  /** Simulates a read-only contract call and returns the decoded value. */
  private async simulate<T>(source: string, method: string, args: xdr.ScVal[]): Promise<T> {
    const account = new Account(source, '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const response = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(response)) {
      throw this.toError(response.error);
    }
    const retval = (response as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return (retval ? scValToNative(retval) : undefined) as T;
  }

  private toError(raw: string): FacilPayContractError {
    const match = /Error\((?:Contract, )?(\d+)\)/.exec(raw);
    const code = match ? Number(match[1]) : undefined;
    return new FacilPayContractError(raw, code);
  }

  // --- Customer/merchant-facing (unsigned) methods ---

  async request(params: RequestRefundParams): Promise<Transaction> {
    return this.buildUnsigned(params.customer, 'request', [
      nativeToScVal(params.paymentId, { type: 'u64' }),
      new Address(params.customer).toScVal(),
      toI128(params.amount),
      nativeToScVal(params.reason, { type: 'u32' }),
    ]);
  }

  async approve(params: ApproveRefundParams): Promise<Transaction> {
    return this.buildUnsigned(params.merchant, 'approve', [
      nativeToScVal(params.refundId, { type: 'u64' }),
      new Address(params.merchant).toScVal(),
    ]);
  }

  async reject(params: RejectRefundParams): Promise<Transaction> {
    return this.buildUnsigned(params.merchant, 'reject', [
      nativeToScVal(params.refundId, { type: 'u64' }),
      new Address(params.merchant).toScVal(),
    ]);
  }

  // --- Read-only methods ---

  async get(refundId: bigint, source: string): Promise<Refund> {
    const raw = await this.simulate<unknown>(source, 'get', [
      nativeToScVal(refundId, { type: 'u64' }),
    ]);
    return decodeRefund(raw);
  }

  // --- Submission ---

  /**
   * Submits a signed transaction and polls until it succeeds or fails.
   * Returns the decoded result and the transaction hash.
   */
  async submit(signedXdr: string): Promise<SubmitResult> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase) as Transaction;
    const sent = await this.server.sendTransaction(tx);

    if (sent.status === 'ERROR') {
      throw this.toError(JSON.stringify(sent.errorResult));
    }

    let response = await this.server.getTransaction(sent.hash);
    while (response.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await this.server.getTransaction(sent.hash);
    }

    if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw this.toError(JSON.stringify(response.resultXdr));
    }

    const retval = (response as SorobanRpc.Api.GetSuccessfulTransactionResponse).returnValue;
    return {
      hash: sent.hash,
      status: 'SUCCESS',
      result: retval ? scValToNative(retval) : undefined,
    };
  }
}
