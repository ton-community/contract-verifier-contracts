import BN from "bn.js";
import { Cell, beginCell, Address } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";

// encode contract storage according to save_data() contract method
export function data(params: { publicKey: Buffer }): Cell {
  return beginCell().storeBuffer(params.publicKey).endCell();
}

export function sendMessage(message: Cell, to: Address, validFrom: number, signature: Buffer) {
  return beginCell()
    .storeUint(validFrom, 32)
    .storeBuffer(signature)
    .storeAddress(to)
    .storeRef(message)
    .endCell();
}
