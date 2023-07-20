import {
  Address,
  beginCell,
  Cell,
  Contract,
  ContractProvider,
  Sender,
  SendMode,
} from "ton-core";

export class SourcesRegistryOnlySetCode implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new SourcesRegistryOnlySetCode(address);
  }

  async sendChangeCode(provider: ContractProvider, via: Sender, value: bigint, newCode: Cell) {
    const body = beginCell().storeUint(9988, 32).storeUint(0, 64).storeRef(newCode).endCell();
    await provider.internal(via, {
      value: value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async getAmIReplaced(provider: ContractProvider): Promise<bigint> {
    const res = await provider.get("get_am_i_replaced", []);
    return res.stack.readBigNumber();
  }
}
