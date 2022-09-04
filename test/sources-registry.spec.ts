import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, Cell, contractAddress, Slice } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as sourcesRegistry from "../contracts/sources-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as sourceRegistryHex } from "../build/sources-registry.compiled.json";
import { hex as sourceItemHex } from "../build/source-item.compiled.json";
import { data, keyToAddress } from "../contracts/sources-registry";

const VERIFIER_ID = "myverifier.com";
const specs = [
  {
    codeCellHash: "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9Q4=",
    verifier: VERIFIER_ID,
    jsonURL: "https://myjson.com/sources.json",
  },
];

describe("Sources", () => {
  let sourceRegistryContract: { contract: SmartContract; address: Address };

  beforeEach(async () => {
    const codeCell = Cell.fromBoc(sourceRegistryHex)[0]; // code cell from build output;
    const dataCell = sourcesRegistry.data({
      ownerAddress: randomAddress("owner"),
    });

    const ca = contractAddress({
      workchain: 0,
      initialCode: codeCell,
      initialData: dataCell,
    });

    sourceRegistryContract = {
      contract: await SmartContract.fromCell(codeCell, dataCell, { debug: true }),
      address: ca,
    };

    sourceRegistryContract.contract.setC7Config({ myself: ca });
  });

  it("should deploy a source contract item", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("owner"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    const msg = send.actionList[0] as SendMsgAction;

    const sourceItemContract = await SmartContract.fromCell(
      msg.message.init!.code!,
      msg.message.init!.data!
    );

    expect(await parseUrlFromGetNftData(sourceItemContract)).to.be.null;

    await sourceItemContract.sendInternalMessage(
      internalMessage({
        from: sourceRegistryContract.address,
        body: msg.message.body,
      })
    );

    expect(await parseUrlFromGetNftData(sourceItemContract)).to.equal(specs[0].jsonURL);
  });

  it("creates a client-side calculable item address", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("owner"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    expect((send.actionList[0] as SendMsgAction).message.info.dest?.toFriendly()).to.equal(
      keyToAddress(
        specs[0].verifier,
        specs[0].codeCellHash,
        sourceRegistryContract.address
      ).toFriendly()
    );
  });

  it("disallows a non-owner to deploy a source item", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notowner"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    expect(send.exit_code).to.equal(401);
  });
});

async function parseUrlFromGetNftData(contract: SmartContract): Promise<string | null> {
  const res = await contract.invokeGetMethod("get_nft_data", []);
  if (res.result[3] !== null) {
    return (res.result[3] as Cell).beginParse().readRemainingBytes().toString("ascii");
  }
  return null;
}
