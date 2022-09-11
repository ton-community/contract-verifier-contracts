import BN from "bn.js";
import { Cell, beginCell, Address } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";

// encode contract storage according to save_data() contract method
export function data(params: { publicKey: Buffer; sourcesRegistry: Address }): Cell {
  return beginCell().storeBuffer(params.publicKey).storeAddress(params.sourcesRegistry).endCell();
}

export function sendMessage(message: Cell, signature: Buffer) {
  return beginCell().storeBuffer(signature).storeRef(message).endCell();
}
