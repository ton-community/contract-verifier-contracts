import BN from "bn.js";
import { Address, InternalMessage, toNano } from "ton";
import { SmartContract } from "ton-contract-executor";
import { ExecutionResult, iTvmBusContract } from "ton-tvm-bus";
import { makeContract } from "./makeContract";
import * as sourcesRegistry from "../../contracts/sources-registry";
import { hex as sourcesRegistryHex } from "../../build/sources-registry.compiled.json";

export class SourcesRegistry implements iTvmBusContract {
  contract?: SmartContract;
  address?: Address;
  initMessageResultRaw?: ExecutionResult | undefined;

  static async create(verifierRegistryAddress: Address, admin: Address) {
    const sourcesRegistryContract = await makeContract(
      sourcesRegistryHex,
      sourcesRegistry.data({
        minTons: toNano(0.065),
        maxTons: toNano(1),
        admin: admin,
        verifierRegistryAddress: verifierRegistryAddress,
      })
    );

    const c = new SourcesRegistry();
    c.address = sourcesRegistryContract.address;
    c.contract = sourcesRegistryContract.contract;
    return c;
  }

  sendInternalMessage(message: InternalMessage): Promise<ExecutionResult> {
    return this.contract!.sendInternalMessage(message); // ?
  }
}
