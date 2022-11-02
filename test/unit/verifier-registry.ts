import BN from "bn.js";
import { Address, InternalMessage } from "ton";
import { SmartContract } from "ton-contract-executor";
import { ExecutionResult, iTvmBusContract } from "ton-tvm-bus";
import { makeContract } from "./makeContract";
import * as verifierRegistry from "../../contracts/verifier-registry";
import { hex as verifierRegistryHex } from "../../build/verifier-registry.compiled.json";

export class VerifierRegistry implements iTvmBusContract {
  contract?: SmartContract;
  address?: Address;
  initMessageResultRaw?: ExecutionResult | undefined;

  static async create(keypair: nacl.SignKeyPair) {
    const verifierRegistryContract = await makeContract(
      verifierRegistryHex,
      verifierRegistry.data({
        publicKey: Buffer.from(keypair.publicKey),
      })
    );

    const v = new VerifierRegistry();
    v.address = verifierRegistryContract.address;
    v.contract = verifierRegistryContract.contract;
    return v;
  }

  sendInternalMessage(message: InternalMessage): Promise<ExecutionResult> {
    return this.contract!.sendInternalMessage(message); // ?
  }
}
