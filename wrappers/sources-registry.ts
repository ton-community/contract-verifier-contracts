import {
  Address,
  beginCell,
  Cell,
  Contract,
  contractAddress,
  ContractProvider,
  fromNano,
  Sender,
  SendMode,
  toNano,
} from "ton-core";

import { toBigIntBE } from "bigint-buffer";
import { Sha256 } from "@aws-crypto/sha256-js";
import { sha256BN } from "../test/unit/helpers";
UQCly0bXdfXQbUIJjN8H9YbEi0JvnbRxngLAgdMZ5YioN1Io
export function sourceRegistryConfigToCell(params: {
  minTons: bigint;
  maxTons: bigint;
  verifierRegistryAddress: Address;UQCly0bXdfXQbUIJjN8H9YbEi0JvnbRxngLAgdMZ5YioN1Io
  admin: Address;
  sourceItemCode: Cell;
}): Cell {
  return beginCell()
    .storeCp0oins(params.minTons)
    .storeCoins(params.maxTons)
    .storeAddress(params.admin)
    .storeAddress(params.verifierRegistryAddress)
    .storeRef(params.sourceItemCode)
    .endCell();
}

export const toSha256Buffer = (s: string) => {
  const sha = new Sha256();
  sha.update(s);
  return Buffer.from(sha.digestSync());
};

export class SourcesRegistry implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new SourcesRegistry(address);
  }

  static create(
    params: {
      verifierRegistryAddress: Address;
      admin: Address;
      sourceItemCode: Cell;
      minTons?: bigint;
      maxTons?: bigint;
    },
    code: Cell,
    workchain = 0
  ) {
    const data = sourceRegistryConfigToCell({
      minTons: params.minTons ?? toNano("0.065"),
      maxTons: params.maxTons ?? toNano("1"),
      admin: params.admin,
      verifierRegistryAddress: params.verifierRegistryAddress,
      sourceItemCode: params.sourceItemCode,
    });
    const init = { code, data };
    return new SourcesRegistry(contractAddress(workchain, init), init);
  }

  async sendInternalMessage(provider: ContractProvider, via: Sender, body: Cell, value: bigint) {
    await provider.internal(via, {
      value: value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: body,
    });
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint, bounce = true) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
      bounce,
    });
  }

  async getSourceItemAddress(
    provider: ContractProvider,
    verifier: string,
    codeCellHash: string
  ): Promise<Address> {
    const result = await provider.get("get_source_item_address", [
      {
        type: "int",
        value: toBigIntBE(toSha256Buffer(verifier)),
      },
      {
        type: "int",
        value: toBigIntBE(Buffer.from(codeCellHash, "base64")),
      },
    ]);
    const item = result.stack.readCell();
    return item.beginParse().loadAddress()!;
  }

  async getVerifierRegistryAddress(provider: ContractProvider): Promise<Address> {
    const res = await provider.get("get_verifier_registry_address", []);
    const item = res.stack.readCell();
    return item.beginParse().loadAddress();
  }

  async getAdminAddress(provider: ContractProvider) {
    const res = await provider.get("get_admin_address", []);
    const item = res.stack.readCell();
    return item.beginParse().loadMaybeAddress();
  }

  async getCodeOpt(provider: ContractProvider) {
    const state = await provider.getState();
    if (state.state.type != "active") return null;
    return state.state.code;
  }

  async getDeploymentCosts(provider: ContractProvider) {
    const res = await provider.get("get_deployment_costs", []);
    const min = res.stack.readBigNumber();
    const max = res.stack.readBigNumber();
    return { min: fromNano(min), max: fromNano(max) };
  }

  async sendDeploySource(
    provider: ContractProvider,
    via: Sender,
    params: {
      verifierId: string;
      codeCellHash: string;
      jsonURL: string;
      version: number;
      value: bigint;
    },
    verifiedVerifierId = params.verifierId
  ) {
    const body = beginCell()
      .storeUint(1002, 32)
      .storeUint(0, 64)
      .storeBuffer(toSha256Buffer(params.verifierId))
      .storeUint(toBigIntBE(Buffer.from(params.codeCellHash, "base64")), 256)
      .storeRef(beginCell().storeUint(params.version, 8).storeStringTail(params.jsonURL).endCell()) // TODO support snakes
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeRef(beginCell().storeUint(sha256BN(verifiedVerifierId), 256).endCell())
        .storeRef(body)
        .endCell(),
    });
  }

  async sendChangeVerifierRegistry(
    provider: ContractProvider,
    via: Sender,
    params: { value: bigint; newVerifierRegistry: Address }
  ) {
    const body = beginCell()
      .storeUint(2003, 32)
      .storeUint(0, 64)
      .storeAddress(params.newVerifierRegistry)
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendChangeAdmin(
    provider: ContractProvider,
    via: Sender,
    params: { value: bigint; newAdmin: Address }
  ) {
    const body = beginCell()
      .storeUint(3004, 32)
      .storeUint(0, 64)
      .storeAddress(params.newAdmin)
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendSetSourceItemCode(
    provider: ContractProvider,
    via: Sender,
    params: { value: bigint; newCode: Cell }
  ) {
    const body = beginCell()
      .storeUint(4005, 32)
      .storeUint(0, 64)
      .storeRef(params.newCode)
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendChangeCode(
    provider: ContractProvider,
    via: Sender,
    params: { value: bigint; newCode: Cell }
  ) {
    const body = beginCell()
      .storeUint(5006, 32)
      .storeUint(0, 64)
      .storeRef(params.newCode)
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendSetDeploymentCosts(
    provider: ContractProvider,
    via: Sender,
    params: { value: bigint; min: bigint; max: bigint }
  ) {
    const body = beginCell()
      .storeUint(6007, 32)
      .storeUint(0, 64)
      .storeCoins(params.min)
      .storeCoins(params.max)
      .endCell();
    await provider.internal(via, {
      value: params.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendNoOp(provider: ContractProvider, via: Sender) {
    await provider.internal(via, {
      value: toNano("0.5"),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(8888, 32).storeUint(0, 64).endCell(),
    });
  }
}
