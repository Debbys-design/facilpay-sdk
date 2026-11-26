import {
  Account,
  Address,
  Keypair,
  Networks,
  Transaction,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { SorobanRpc } from '@stellar/stellar-sdk';
import { FacilPayContractError, FACILPAY_CONTRACT_ERRORS } from './payment';
import type { FacilPayNetwork, SubmitResult } from './payment';

export interface EscrowContractOptions {
  contractId: string;
  network?: FacilPayNetwork;
  rpcUrl?: string;
  server?: SorobanRpc.Server;
}

export interface CreateEscrowParams {
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: bigint;
  token: string;
  deadline?: number;
}

export interface Escrow {
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: bigint;
  token: string;
  status: 'created' | 'released' | 'refunded' | 'disputed';
  deadline?: number;
}

export interface EscrowActionParams {
  escrowId: string;
  signer: string;
}

export interface GetEscrowParams {
  escrowId: string;
}

const ESCROW_ERRORS: Record<number, string> = {
  1: 'Escrow not found',
  2: 'Escrow already settled',
  3: 'Unauthorized signer',
  4: 'Invalid escrow state',
  5: 'Escrow deadline not reached',
};

function mapEscrowError(code: number): FacilPayContractError {
  const message = ESCROW_ERRORS[code] ?? FACILPAY_CONTRACT_ERRORS[code] ?? `Escrow contract error ${code}`;
  return new FacilPayContractError(code, message);
}

export class EscrowContract {
  private readonly contractId: string;
  private readonly network: FacilPayNetwork;
  private readonly server: SorobanRpc.Server;

  constructor(options: EscrowContractOptions) {
    this.contractId = options.contractId;
    this.network = options.network ?? 'testnet';
    this.server = options.server ?? new SorobanRpc.Server(options.rpcUrl ?? 'https://soroban-testnet.stellar.org');
  }

  private get networkPassphrase(): string {
    return this.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  }

  private async build(method: string, args: xdr.ScVal[], signer: string): Promise<Transaction> {
    const account = await this.server.getAccount(signer);
    return new TransactionBuilder(new Account(signer, account.sequenceNumber()), {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: method,
          args,
        }),
      )
      .setTimeout(30)
      .build();
  }

  private async simulate(tx: Transaction): Promise<SorobanRpc.SimulateTransactionResponse> {
    const simulation = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new FacilPayContractError(-1, simulation.error);
    }
    return simulation;
  }

  private async sign(tx: Transaction, signer: Keypair): Promise<Transaction> {
    tx.sign(signer);
    return tx;
  }

  private async submit(tx: Transaction): Promise<SubmitResult> {
    const response = await this.server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw new FacilPayContractError(-1, 'Transaction submission failed');
    }
    return { hash: response.hash, status: response.status };
  }

  async create(params: CreateEscrowParams, signer: Keypair): Promise<SubmitResult> {
    const args = [
      new Address(params.depositor).toScVal(),
      new Address(params.beneficiary).toScVal(),
      new Address(params.arbiter).toScVal(),
      nativeToScVal(params.amount, { type: 'i128' }),
      new Address(params.token).toScVal(),
      nativeToScVal(params.deadline ?? 0, { type: 'u64' }),
    ];
    const tx = await this.build('create', args, params.depositor);
    const prepared = await this.simulate(tx);
    const assembled = SorobanRpc.assembleTransaction(tx, prepared).build();
    return this.submit(await this.sign(assembled, signer));
  }

  async release(params: EscrowActionParams, signer: Keypair): Promise<SubmitResult> {
    return this.invokeAction('release', params, signer);
  }

  async refund(params: EscrowActionParams, signer: Keypair): Promise<SubmitResult> {
    return this.invokeAction('refund', params, signer);
  }

  async dispute(params: EscrowActionParams, signer: Keypair): Promise<SubmitResult> {
    return this.invokeAction('dispute', params, signer);
  }

  private async invokeAction(method: string, params: EscrowActionParams, signer: Keypair): Promise<SubmitResult> {
    const args = [nativeToScVal(params.escrowId, { type: 'string' }), new Address(params.signer).toScVal()];
    const tx = await this.build(method, args, params.signer);
    const prepared = await this.simulate(tx);
    const assembled = SorobanRpc.assembleTransaction(tx, prepared).build();
    return this.submit(await this.sign(assembled, signer));
  }

  async get(params: GetEscrowParams): Promise<Escrow> {
    const tx = await this.build('get', [nativeToScVal(params.escrowId, { type: 'string' })], this.contractId);
    const simulation = await this.simulate(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new FacilPayContractError(-1, 'Escrow not found');
    }
    const raw = scValToNative(simulation.result.retval) as Record<string, unknown>;
    return {
      depositor: String(raw.depositor),
      beneficiary: String(raw.beneficiary),
      arbiter: String(raw.arbiter),
      amount: BigInt(raw.amount as bigint),
      token: String(raw.token),
      status: raw.status as Escrow['status'],
      deadline: raw.deadline !== undefined ? Number(raw.deadline) : undefined,
    };
  }
}
