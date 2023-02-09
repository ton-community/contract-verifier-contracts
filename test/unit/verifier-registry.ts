import { SmartContract } from "ton-contract-executor";
import { buildRegistryDataCell, RegistryData, Verifier } from "./RegistryData";
import { Address, Cell, contractAddress, InternalMessage, Slice, toNano } from "ton";
import BN from "bn.js";
import { hex } from "../../build/verifier-registry.compiled.json";
import { ExecutionResult, iTvmBusContract } from "ton-tvm-bus";

export class VerifierRegistry implements iTvmBusContract {
  private constructor(public readonly contract: SmartContract, public readonly address: Address) {}

  initMessageResultRaw?: ExecutionResult | undefined;
  sendInternalMessage(message: InternalMessage): Promise<ExecutionResult> {
    return this.contract!.sendInternalMessage(message);
  }

  //
  // Get methods
  //

  async getVerifier(id: BN): Promise<{ admin: Address | null; settings: Cell | null }> {
    let res = await this.contract.invokeGetMethod("get_verifier", [
      {
        type: "int",
        value: id.toString(10),
      },
    ]);
    if (res.exit_code !== 0) {
      throw new Error(`Unable to invoke get_verifier on contract`);
    }
    let [sl, settings, ok] = res.result as [Slice, Cell, BN];
    if (ok.toNumber() == 0) {
      return {
        admin: null,
        settings: null,
      };
    }

    return {
      admin: sl.readAddress(),
      settings,
    };
  }

  async getVerifiersNum(): Promise<number> {
    let res = await this.contract.invokeGetMethod("get_verifiers_num", []);
    if (res.exit_code !== 0) {
      throw new Error(`Unable to invoke get_verifiers_num on contract`);
    }
    let [num] = res.result as [BN];

    return num.toNumber();
  }

  async getVerifiers(): Promise<Verifier[]> {
    let res = await this.contract.invokeGetMethod("get_verifiers", []);
    if (res.exit_code !== 0) {
      throw new Error(`Unable to invoke get_verifiers on contract ${res.exit_code}`);
    }
    const [c] = res.result as [Slice];
    // console.log(c.toCell().toString())
    const d = c.readDict(256, (s) => s);

    return Array.from(d.values()).map((v) => {
      const admin = v.readAddress()!;
      const quorom = v.readUint(8).toNumber();
      const pubKeyEndpoints = v.readDict(256, (s) => s.readUint(32).toNumber());

      return {
        admin: admin,
        quorum: quorom,
        pub_key_endpoints: new Map<BN, number>(
          Array.from(pubKeyEndpoints.entries()).map(([k, v]) => [new BN(k), v])
        ),
        name: v.readRef().readRemainingBytes().toString(),
        marketingUrl: v.readRef().readRemainingBytes().toString(),
      };
    });
  }

  //
  // Internal messages
  //

  static async createFromConfig(config: RegistryData, num?: number) {
    let data = buildRegistryDataCell(config, num);
    let contract = await SmartContract.fromCell(Cell.fromBoc(hex)[0], data, {
      debug: true,
    });
    let address = contractAddress({
      workchain: 0,
      initialData: contract.dataCell,
      initialCode: contract.codeCell,
    });

    contract.setC7Config({
      balance: toNano(1),
      myself: address,
      randSeed: new BN(1),
      transLt: 7,
      unixtime: 1000,
    });

    return new VerifierRegistry(contract, address);
  }
}
