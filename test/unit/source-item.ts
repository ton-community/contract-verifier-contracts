import { Address, Cell, InternalMessage } from "ton";
import { SmartContract } from "ton-contract-executor";
import { ExecutionResult, iTvmBusContract, iDeployableContract, TvmBus } from "ton-tvm-bus";
import { hex as sourceItemHex } from "../../build/source-item.compiled.json";

export class SourceItem implements iDeployableContract, iTvmBusContract {
  getCodeCell(): Cell[] {
    return Cell.fromBoc(sourceItemHex);
  }

  async createFromMessage(
    code: Cell,
    data: Cell,
    initMessage: InternalMessage,
    tvmBus: TvmBus
  ): Promise<iTvmBusContract> {
    const si = new SourceItem();
    const c = await SmartContract.fromCell(code, data, { debug: true });

    si.address = initMessage.to;
    si.contract = c;
    c.setC7Config({ myself: si.address }); // todo balance
    const res = await c.sendInternalMessage(initMessage);
    const initMessageResponse = {
      ...res,
    };

    // @ts-ignore
    si.initMessageResult = initMessageResponse;
    // @ts-ignore
    si.initMessageResultRaw = res;

    if (tvmBus) {
      tvmBus.registerContract(si);
    }

    return si;
  }
  contract?: SmartContract;
  address?: Address;
  initMessageResultRaw?: ExecutionResult | undefined;

  sendInternalMessage(message: InternalMessage): Promise<ExecutionResult> {
    return this.contract!.sendInternalMessage(message); // ?
  }

  async getData(): Promise<Cell> {
    const res = await this.contract!.invokeGetMethod("get_source_item_data", []);
    return res.result[3] as Cell;
  }
}
