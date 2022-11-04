import dotenv from "dotenv";
import {
  Address,
  beginCell,
  Cell,
  CellMessage,
  CommonMessageInfo,
  InternalMessage,
  SendMode,
  StateInit,
  toNano,
  TonClient,
  WalletContract,
  WalletV3R2Source,
} from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { KeyPair, mnemonicNew, mnemonicToWalletKey } from "ton-crypto";
import BN from "bn.js";
import {
  changeVerifierRegistry,
  changeAdmin as changeAdminOp,
  changeCode,
  setSourceItemCode,
} from "../../contracts/sources-registry";
import { zeroAddress } from "../unit/helpers";
import { makeGetCall } from "./makeGetCall";
import { assert } from "chai";

import { hex as actualSourceRegistryHex } from "../../build/sources-registry.compiled.json";
import { hex as dummySourceRegistryHex } from "../../build/sources-registry-only-set-code.compiled.json";
import { hex as actualSourceItemHex } from "../../build/source-item.compiled.json";
import { hex as dummySourceItemHex } from "../../build/source-item-dummy.compiled.json";
import { deploySource } from "../../contracts/sources-registry";
import { Sha256 } from "@aws-crypto/sha256-js";

dotenv.config();

const ACTUAL_VERIFIER_REGISTRY = Address.parse("EQDZeSc_Mwu7YKcjopglrDLpLZsHGD5z1TK0xzEhD5ic8kBn");

async function getWallet(tc: TonClient, mnemonic: string[]) {
  const deployerMnemonic = mnemonic.join(" "); //(await mnemonicNew(24)).join(" ");

  const walletKey = await mnemonicToWalletKey(deployerMnemonic.split(" "));
  const walletContract = WalletContract.create(
    tc,
    WalletV3R2Source.create({ publicKey: walletKey.publicKey, workchain: 0 })
  );
  return { walletContract, walletKey };
}

async function makeTXN(
  wallet: WalletStruct,
  client: TonClient,
  { to, value, message }: { to: Address; value: BN; message: Cell }
) {
  const seqnoBefore = await wallet.walletContract.getSeqNo();
  const transfer = wallet.walletContract.createTransfer({
    secretKey: wallet.walletKey.secretKey,
    seqno: seqnoBefore,
    sendMode: SendMode.PAY_GAS_SEPARATLY + SendMode.IGNORE_ERRORS,
    order: new InternalMessage({
      to,
      value,
      bounce: false,
      body: new CommonMessageInfo({
        body: new CellMessage(message),
      }),
    }),
  });
  await client.sendExternalMessage(wallet.walletContract, transfer);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  while (true) {
    await sleep(2000);
    const seqnoAfter = await wallet.walletContract.getSeqNo();
    if (seqnoAfter > seqnoBefore) return;
  }
}

type WalletStruct = {
  walletContract: WalletContract;
  walletKey: KeyPair;
};

async function changeVerifierRegistryTests(
  sourcesRegistryContract: Address,
  tc: TonClient,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing changeVerifierRegistry()");

  async function getVerifierRegistryAddress() {
    return await makeGetCall(
      sourcesRegistryContract,
      "get_verifier_registry_address",
      [],
      (s) => (s[0] as Cell).beginParse().readAddress()!,
      tc
    );
  }

  async function changeVerifier(address: Address) {
    await makeTXN(wallet, tc, {
      to: sourcesRegistryContract,
      value: toNano(0.01),
      message: changeVerifierRegistry(address),
    });
  }

  const verifierBefore = await getVerifierRegistryAddress();
  console.log("Current verifier address is: ", verifierBefore.toFriendly());

  await changeVerifier(zeroAddress);

  const verifierAfter = await getVerifierRegistryAddress();
  console.log("After change to zero addr - verifier address is: ", verifierAfter.toFriendly());

  assert(
    verifierAfter.toFriendly() === zeroAddress.toFriendly(),
    "verifier registry address should be zero address"
  );

  await changeVerifier(ACTUAL_VERIFIER_REGISTRY);
  const verifierReverted = await getVerifierRegistryAddress();

  assert(
    verifierReverted.toFriendly() === ACTUAL_VERIFIER_REGISTRY.toFriendly(),
    "verifier registry address should be reverted to original address"
  );

  console.log("After revert - verifier address is: ", verifierReverted.toFriendly());
}

async function replaceAdmin(
  sourcesRegistryContract: Address,
  wallet: WalletStruct,
  newAdmin: Address,
  tc: TonClient
) {
  console.log("ℹ️ Replacing admin");

  async function getAdminAddress() {
    return await makeGetCall(
      sourcesRegistryContract,
      "get_admin_address",
      [],
      (s) => (s[0] as Cell).beginParse().readAddress()!,
      tc
    );
  }

  async function replaceAdminTXN(address: Address) {
    await makeTXN(wallet, tc, {
      to: sourcesRegistryContract,
      value: toNano(0.01),
      message: changeAdminOp(address),
    });
  }

  const adminBefore = await getAdminAddress();
  console.log("Current admin is: ", adminBefore.toFriendly());

  await replaceAdminTXN(newAdmin);

  const adminAfter = await getAdminAddress();
  console.log("After change, admin is: ", adminAfter.toFriendly());

  assert(adminAfter.toFriendly() === newAdmin.toFriendly(), "Admin should be changed to new admin");
}

async function setCodeTests(sourcesRegistryContract: Address, tc: TonClient, wallet: WalletStruct) {
  console.log("ℹ️ Testing setCode()");
  const dumyCodeCell = Cell.fromBoc(dummySourceRegistryHex)[0];
  const actualCodeCell = Cell.fromBoc(actualSourceRegistryHex)[0];

  await makeTXN(wallet, tc, {
    to: sourcesRegistryContract,
    value: toNano(0.01),
    message: changeCode(dumyCodeCell),
  });

  const resp = await makeGetCall(
    sourcesRegistryContract,
    "get_am_i_replaced",
    [],
    (s) => s[0] as BN,
    tc
  );
  assert(resp.toNumber() === 742, "Contract should be replaced");

  // Revert code
  await makeTXN(wallet, tc, {
    to: sourcesRegistryContract,
    value: toNano(0.01),
    message: beginCell().storeUint(9988, 32).storeUint(0, 64).storeRef(actualCodeCell).endCell(),
  });
}

async function setSourceItemCodeTests(
  sourcesRegistryContract: Address,
  tc: TonClient,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing setSourceItemCode()");

  const dumyCodeCell = Cell.fromBoc(dummySourceItemHex)[0];
  const actualCodeCell = Cell.fromBoc(actualSourceItemHex)[0];

  const origSourceItem = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [new BN(toSha256Buffer("testverifier")), new BN(Buffer.from("dummyCodeCellHash", "base64"))],
    (s) => (s[0] as Cell).beginParse().readAddress()!,
    tc
  );

  await makeTXN(wallet, tc, {
    to: sourcesRegistryContract,
    value: toNano(0.01),
    message: setSourceItemCode(dumyCodeCell),
  });

  const modifiedSourceItem = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [new BN(toSha256Buffer("testverifier")), new BN(Buffer.from("dummyCodeCellHash", "base64"))],
    (s) => (s[0] as Cell).beginParse().readAddress()!,
    tc
  );

  assert(
    origSourceItem.toFriendly() !== modifiedSourceItem.toFriendly(),
    "Source item address should be changed"
  );

  await makeTXN(wallet, tc, {
    to: sourcesRegistryContract,
    value: toNano(0.01),
    message: setSourceItemCode(actualCodeCell),
  });

  const originalSourceItem2 = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [new BN(toSha256Buffer("testverifier")), new BN(Buffer.from("dummyCodeCellHash", "base64"))],
    (s) => (s[0] as Cell).beginParse().readAddress()!,
    tc
  );

  assert(
    origSourceItem.toFriendly() === originalSourceItem2.toFriendly(),
    "Source item address should equal after revert"
  );
}

function toSha256Buffer(s: string) {
  const sha = new Sha256();
  sha.update(s);
  return Buffer.from(sha.digestSync());
}

(async function E2E({ sourcesRegistryContract }: { sourcesRegistryContract: Address }) {
  const endpoint = await getHttpEndpoint();
  const tc = new TonClient({ endpoint });

  const [wallet1, wallet2] = [
    await getWallet(tc, process.env.E2E_WALLET_1!.split(" ")),
    await getWallet(tc, process.env.E2E_WALLET_2!.split(" ")),
  ];

  await replaceAdmin(sourcesRegistryContract, wallet1, wallet2.walletContract.address, tc);
  await changeVerifierRegistryTests(sourcesRegistryContract, tc, wallet2);
  await setCodeTests(sourcesRegistryContract, tc, wallet2);
  await replaceAdmin(sourcesRegistryContract, wallet2, wallet1.walletContract.address, tc);
  await setSourceItemCodeTests(sourcesRegistryContract, tc, wallet1);
})({ sourcesRegistryContract: Address.parse("EQD-BJSVUJviud_Qv7Ymfd3qzXdrmV525e3YDzWQoHIAiInL") });
