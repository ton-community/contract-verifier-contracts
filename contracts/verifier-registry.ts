import BN from "bn.js";
import { Cell, beginCell, Address } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";
import nacl from "tweetnacl";

// encode contract storage according to save_data() contract method
export function data(params: { publicKey: Buffer }): Cell {
  return beginCell().storeBuffer(params.publicKey).endCell();
}

export function sendMessage(message: Cell, to: Address, validFrom: number, secretKey: Uint8Array) {
  const signedMsg = beginCell().storeUint(validFrom, 32).storeRef(message).endCell();
  const sig = nacl.sign.detached(signedMsg.hash(), secretKey);

  return beginCell()
    .storeBuffer(Buffer.from(sig))
    .storeAddress(to)
    .storeRef(beginCell().storeUint(validFrom, 32).storeRef(message).endCell())
    .endCell();
}
