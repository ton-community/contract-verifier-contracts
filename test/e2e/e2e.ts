import dotenv from "dotenv";
import {
  Address,
  beginCell,
  Cell,
  SendMode,
  toNano,
  TonClient,
  WalletContractV3R2,
  OpenedContract,
} from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { KeyPair, mnemonicToWalletKey } from "ton-crypto";
import { assert } from "chai";
import { Sha256 } from "@aws-crypto/sha256-js";

import {
  changeVerifierRegistry,
  changeAdmin as changeAdminOp,
  changeCode,
  setSourceItemCode,
} from "../../contracts/sources-registry";
import { zeroAddress } from "../unit/helpers";
import { makeGetCall } from "./makeGetCall";
import { toBigIntBE } from "bigint-buffer";

import { hex as actualSourceRegistryHex } from "../../build/sources-registry.compiled.json";
import { hex as dummySourceRegistryHex } from "../../build/sources-registry-only-set-code.compiled.json";
import { hex as actualSourceItemHex } from "../../build/source-item.compiled.json";
import { hex as dummySourceItemHex } from "../../build/source-item-dummy.compiled.json";

dotenv.config();

const ACTUAL_VERIFIER_REGISTRY = Address.parse("EQDZeSc_Mwu7YKcjopglrDLpLZsHGD5z1TK0xzEhD5ic8kBn");

async function getWallet(tc: TonClient, mnemonic: string[]) {
  const deployerMnemonic = mnemonic.join(" "); //(await mnemonicNew(24)).join(" ");

  const walletKey = await mnemonicToWalletKey(deployerMnemonic.split(" "));
  const walletContract = tc.open(
    WalletContractV3R2.create({ publicKey: walletKey.publicKey, workchain: 0 })
  );
  return { walletContract, walletKey };
}

async function makeTXN(
  wallet: WalletStruct,
  client: TonClient,
  { dest, value, message }: { dest: Address; value: bigint; message: Cell }
) {
  const seqnoBefore = await wallet.walletContract.getSeqno();
  const transfer = wallet.walletContract.createTransfer({
    secretKey: wallet.walletKey.secretKey,
    seqno: seqnoBefore,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [
      {
        info: {
          type: "internal",
          dest,
          value: { coins: value },
          bounce: false,
          bounced: false,
          ihrDisabled: true,
          ihrFee: BigInt(0),
          forwardFee: BigInt(0),
          createdAt: 0,
          createdLt: BigInt(0),
        },
        body: message,
      },
    ],
  });
  await client.sendExternalMessage(wallet.walletContract, transfer);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  while (true) {
    await sleep(2000);
    const seqnoAfter = await wallet.walletContract.getSeqno();
    if (seqnoAfter > seqnoBefore) return;
  }
}

type WalletStruct = {
  walletContract: OpenedContract<WalletContractV3R2>;
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
      (s) => (s[0] as Cell).beginParse().loadAddress()!,
      tc
    );
  }

  async function changeVerifier(address: Address) {
    await makeTXN(wallet, tc, {
      dest: sourcesRegistryContract,
      value: toNano("0.01"),
      message: changeVerifierRegistry(address),
    });
  }

  const verifierBefore = await getVerifierRegistryAddress();
  console.log("Current verifier address is: ", verifierBefore.toString());

  await changeVerifier(zeroAddress);

  const verifierAfter = await getVerifierRegistryAddress();
  console.log("After change to zero addr - verifier address is: ", verifierAfter.toString());

  assert(verifierAfter.equals(zeroAddress), "verifier registry address should be zero address");

  await changeVerifier(ACTUAL_VERIFIER_REGISTRY);
  const verifierReverted = await getVerifierRegistryAddress();

  assert(
    verifierReverted.equals(ACTUAL_VERIFIER_REGISTRY),
    "verifier registry address should be reverted to original address"
  );

  console.log("After revert - verifier address is: ", verifierReverted.toString());
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
      (s) => (s[0] as Cell).beginParse().loadAddress()!,
      tc
    );
  }

  async function replaceAdminTXN(address: Address) {
    await makeTXN(wallet, tc, {
      dest: sourcesRegistryContract,
      value: toNano("0.01"),
      message: changeAdminOp(address),
    });
  }

  const adminBefore = await getAdminAddress();
  console.log("Current admin is: ", adminBefore.toString());

  await replaceAdminTXN(newAdmin);

  const adminAfter = await getAdminAddress();
  console.log("After change, admin is: ", adminAfter.toString());

  assert(adminAfter.equals(newAdmin), "Admin should be changed to new admin");
}

async function setCodeTests(sourcesRegistryContract: Address, tc: TonClient, wallet: WalletStruct) {
  console.log("ℹ️ Testing setCode()");
  const dumyCodeCell = Cell.fromBoc(Buffer.from(dummySourceRegistryHex, "hex"))[0];
  const actualCodeCell = Cell.fromBoc(Buffer.from(actualSourceRegistryHex, "hex"))[0];

  await makeTXN(wallet, tc, {
    dest: sourcesRegistryContract,
    value: toNano("0.01"),
    message: changeCode(dumyCodeCell),
  });

  const resp = await makeGetCall(
    sourcesRegistryContract,
    "get_am_i_replaced",
    [],
    (s) => s[0] as bigint,
    tc
  );
  assert(resp === BigInt(742), "Contract should be replaced");

  // Revert code
  await makeTXN(wallet, tc, {
    dest: sourcesRegistryContract,
    value: toNano("0.01"),
    message: beginCell().storeUint(9988, 32).storeUint(0, 64).storeRef(actualCodeCell).endCell(),
  });
}

async function setSourceItemCodeTests(
  sourcesRegistryContract: Address,
  tc: TonClient,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing setSourceItemCode()");

  const dumyCodeCell = Cell.fromBoc(Buffer.from(dummySourceItemHex, "hex"))[0];
  const actualCodeCell = Cell.fromBoc(Buffer.from(actualSourceItemHex, "hex"))[0];

  const origSourceItem = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [
      toBigIntBE(toSha256Buffer("testverifier")),
      toBigIntBE(Buffer.from("dummyCodeCellHash", "base64")),
    ],
    (s) => (s[0] as Cell).beginParse().loadAddress()!,
    tc
  );

  await makeTXN(wallet, tc, {
    dest: sourcesRegistryContract,
    value: toNano("0.01"),
    message: setSourceItemCode(dumyCodeCell),
  });

  const modifiedSourceItem = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [
      toBigIntBE(toSha256Buffer("testverifier")),
      toBigIntBE(Buffer.from("dummyCodeCellHash", "base64")),
    ],
    (s) => (s[0] as Cell).beginParse().loadAddress()!,
    tc
  );

  assert(origSourceItem.equals(modifiedSourceItem), "Source item address should be changed");

  await makeTXN(wallet, tc, {
    dest: sourcesRegistryContract,
    value: toNano("0.01"),
    message: setSourceItemCode(actualCodeCell),
  });

  const originalSourceItem2 = await makeGetCall(
    sourcesRegistryContract,
    "get_source_item_address",
    [
      toBigIntBE(toSha256Buffer("testverifier")),
      toBigIntBE(Buffer.from("dummyCodeCellHash", "base64")),
    ],
    (s) => (s[0] as Cell).beginParse().loadAddress()!,
    tc
  );

  assert(
    origSourceItem.equals(originalSourceItem2),
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
})({ sourcesRegistryContract: Address.parse("EQCFYXRqFFnXfXSnicF8vYxR7jGw4T9B3aNVpeHHVzR2jnuv") });
