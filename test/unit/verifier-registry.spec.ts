import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import nacl from "tweetnacl";

import { Address, Slice, beginCell } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as verifierRegistry from "../../contracts/verifier-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as verifierRegistryHex } from "../../build/verifier-registry.compiled.json";
import { makeContract } from "./makeContract";

export function timeUnixTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}

describe("Verifier Registry", () => {
  let verifierRegistryContract: { contract: SmartContract; address: Address };
  const kp = nacl.sign.keyPair.fromSecretKey(
    new Uint8Array(
      Buffer.from(
        "z2Wkf2sWS8arwVLSh+uH6FMA6uiIudDS/pyfPjWkVgPcMGPrkPwJL5re6dcdBXDpGkxzs2xt8fwDNd8evQ9FFw==",
        "base64"
      )
    )
  );

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
          timeUnixTimeStamp(0),
          nacl.sign.keyPair().secretKey
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
          timeUnixTimeStamp(0),
          kp.secretKey
        ),
      })
    );

    // console.log(send);
    expect(send.exit_code).to.equal(998);
  });

  it("Refuses to send a message older than 10 minutes", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          beginCell().endCell(),
          sourcesRegistryAddress,
          timeUnixTimeStamp(-11),
          kp.secretKey
        ),
      })
    );

    expect(send.exit_code).to.equal(997);
  });

  it("Sends a message to the specified contract", async () => {
    const msg = beginCell().storeBuffer(Buffer.from("ipfs://deddy", "ascii")).endCell();

    // from: addr1 => [
    //   0,
    //   {
    //     pks: [pk1,pk2,pk3,...,pk10] ;; to change this a mutlisig pk is needed,
    //     multiSigThreshold: 3
    //   },
    //   10k,
    //   seqno: 0
    // ]

    /*
    client -> sourcesBinaryData+codecell hash to backend1
    backend1 responds with => ipfs://[sources.json], sig(ipfs://[sources.json])
    client -> ipfs://[sources.json]+codecell hash to backend2
    backend2 responds with => ipfs://[sources.json], sig(ipfs://[sources.json])
    client -> ipfs://[sources.json]+codecell hash+signatures to backend3
    backend3:
      - reads multisig threshold from contract, sees that it == 3, uploads signatures
      - responds with => ipfs://[sources.json], sig(ipfs://[sources.json]), ipfs://[signatures.json]
    client -> verifier registry => ipfs://[sources.json], [sigs], ipfs://[signatures.json]
    */

    // [
    //   signatures, // [[sig1(msg),pk1], [sig2(msg),pk2], [sig3(msg), pk3]] ;; buffer("ipfs://[sigs.json]")
    //   msg // 162137233, buffer("ipfs://[sources.json]")
    // ]

    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          msg,
          randomAddress("myaddr"),
          timeUnixTimeStamp(0),
          kp.secretKey
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
