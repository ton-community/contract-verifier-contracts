import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import nacl from "tweetnacl";

import { Address, Slice, beginCell } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as verifierRegistry from "../contracts/verifier-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as verifierRegistryHex } from "../build/verifier-registry.compiled.json";
import { makeContract } from "./makeContract";

export function timeUnitTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}

describe("Verifier Registry", () => {
  let verifierRegistryContract: { contract: SmartContract; address: Address };
  const kp = nacl.sign.keyPair();
  const sourcesRegistryAddress = randomAddress("sources-reg");

  beforeEach(async () => {
    verifierRegistryContract = await makeContract(
      verifierRegistryHex,
      verifierRegistry.data({
        publicKey: Buffer.from(kp.publicKey),
      })
    );
  });

  it("Refuses to send a message not signed by the public key", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          beginCell().storeUint(1, 1).endCell(),
          sourcesRegistryAddress,
          timeUnitTimeStamp(0),
          Buffer.alloc(64, "0")
        ),
      })
    );

    expect(send.exit_code).to.equal(999);
  });

  it("Refuses to send an empty message", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          beginCell().endCell(),
          sourcesRegistryAddress,
          timeUnitTimeStamp(0),
          Buffer.alloc(64, "1")
        ),
      })
    );

    // console.log(send);
    expect(send.exit_code).to.equal(998);
  });

  it("Refuses to send a message older than 30 minutes", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          beginCell().endCell(),
          sourcesRegistryAddress,
          timeUnitTimeStamp(-31),
          Buffer.alloc(64, "1")
        ),
      })
    );

    expect(send.exit_code).to.equal(997);
  });

  it("Sends a message to the specified contract", async () => {
    const msg = beginCell().storeUint(2, 1023).endCell();

    const sig = nacl.sign.detached(msg.hash(), kp.secretKey);
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          msg,
          randomAddress("myaddr"),
          timeUnitTimeStamp(0),
          Buffer.from(sig)
        ),
      })
    );

    expect(send.exit_code).to.equal(0);
    expect(send.type).to.equal("success");

    const messageToSourcesReg = (send.actionList[0] as SendMsgAction).message;

    // Message is sent to sources registry
    expect(messageToSourcesReg.info.dest!.toFriendly()).to.equal(
      randomAddress("myaddr").toFriendly()
    );

    // Original message is forwarded as-is
    expect(messageToSourcesReg.body.hash().toString()).to.equal(msg.hash().toString());
  });
});
