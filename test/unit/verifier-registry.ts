import { SmartContract } from "ton-contract-executor";
import {
  Address,
  beginCell,
  beginDict,
  Cell,
  contractAddress,
  InternalMessage,
  Slice,
  toNano,
} from "ton";
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

export type Verifier = {
  admin: Address;
  quorum: number;
  pub_key_endpoints: Map<BN, number>;
  name: string;
  marketingUrl: string;
};

export type RegistryData = {
  verifiers: Map<BN, Verifier>;
};

export async function generateCodeAndData(cfg: RegistryData) {
  let collection = await VerifierRegistry.createFromConfig(cfg);

  console.log("code:\n" + collection.contract.codeCell.toBoc({ idx: false }).toString("hex"));
  console.log("data:\n" + collection.contract.dataCell.toBoc({ idx: false }).toString("hex"));
}

export function buildRegistryDataCell(data: RegistryData, num?: number) {
  let dataCell = beginCell();
  let e = beginDict(256);
  data.verifiers.forEach(function (val: Verifier, key: BN) {
    let x = beginCell().storeAddress(val.admin).storeUint(val.quorum, 8);

    let points = beginDict(256);
    val.pub_key_endpoints.forEach(function (eVal: number, eKey: BN) {
      points.storeCell(eKey, beginCell().storeUint(eVal, 32).endCell());
    });

    x.storeDict(points.endDict());
    x.storeRef(beginCell().storeBuffer(Buffer.from(val.name)).endCell());
    x.storeRef(beginCell().storeBuffer(Buffer.from(val.marketingUrl)).endCell());
    e.storeCell(key, x.endCell());
  });

  if (num === undefined) {
    num = 0;
  }

  dataCell.storeDict(e.endDict()).storeUint(num, 8);

  return dataCell.endCell();
}

export const OperationCodes = {
  removeVerifier: 0x19fa5637,
  updateVerifier: 0x6002d61a,
  forwardMessage: 0x75217758,
};

export type CollectionMintItemInput = {
  passAmount: BN;
  index: number;
  ownerAddress: Address;
  content: string;
};

export const Queries = {
  removeVerifier: (params: { queryId?: number; id: BN }) => {
    let msgBody = new Cell();
    msgBody.bits.writeUint(OperationCodes.removeVerifier, 32);
    msgBody.bits.writeUint(params.queryId || 0, 64);
    msgBody.bits.writeUint(params.id, 256);
    return msgBody;
  },
  updateVerifier: (params: {
    queryId?: number;
    id: BN;
    quorum: number;
    endpoints: Map<BN, number>;
    name: string;
    marketingUrl: string;
  }) => {
    let msgBody = new Cell();
    msgBody.bits.writeUint(OperationCodes.updateVerifier, 32);
    msgBody.bits.writeUint(params.queryId || 0, 64);
    msgBody.bits.writeUint(params.id, 256);
    msgBody.bits.writeUint(params.quorum, 8);

    let e = beginDict(256);
    params.endpoints.forEach(function (val: number, key: BN) {
      e.storeCell(key, beginCell().storeUint(val, 32).endCell());
    });

    msgBody.bits.writeBit(true);
    msgBody.refs.push(e.endCell());
    msgBody.refs.push(beginCell().storeBuffer(Buffer.from(params.name)).endCell());
    msgBody.refs.push(beginCell().storeBuffer(Buffer.from(params.marketingUrl)).endCell());

    return msgBody;
  },
  forwardMessage: (params: { queryId?: number; desc: Cell; signatures: Map<BN, Buffer> }) => {
    let msgBody = new Cell();
    msgBody.bits.writeUint(OperationCodes.forwardMessage, 32);
    msgBody.bits.writeUint(params.queryId || 0, 64);
    msgBody.refs.push(params.desc);

    let signatures = new Cell();
    if (params.signatures.size > 0) {
      params.signatures.forEach(function (val, key) {
        signatures.bits.writeBuffer(val);
        signatures.bits.writeUint(key, 256);

        let s = new Cell();
        s.refs.push(signatures);
        signatures = s;
      });
      signatures = signatures.refs[0];
    }

    msgBody.refs.push(signatures);

    return msgBody;
  },
};

export function buildMsgDescription(
  id: BN,
  validTill: number,
  source: Address,
  target: Address,
  msg: Cell
) {
  let desc = new Cell();
  desc.bits.writeUint(id, 256);
  desc.bits.writeUint(validTill, 32);
  desc.bits.writeAddress(source);
  desc.bits.writeAddress(target);
  desc.refs.push(msg);

  return desc;
}
