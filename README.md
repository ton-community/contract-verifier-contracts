# contract-verifier-contracts

A sources registry contract for registering a data url for a given code cell hash.
The contract accepts messages from a designated verifier registry contract.
> The verifier registry in this repo is a simplified version. The actual verifier registry to be used is https://github.com/shaharyakir/registry-contract
(TODO change when verifier registry has a final repo)

Implementation is based on [TEP-91 suggestion](https://github.com/ton-blockchain/TEPs/pull/91)

## E2E tests
(e2e.ts in test/e2e)
1. Pre-deploy (using `npm run build && npm run deploy`) the sources registry contract -> change min_tons in sources_registry.fc to a small amount, otherwise tests are too costly. 
2. Provide two mnemonics via .env
3. Flows carried out:
   * (Sender: wallet1) Change admin from wallet1 to wallet2
   * (Sender: wallet2) Change verifier address from actual to zero address; then revert to actual
   * (Sender: wallet2) Set code to `sources-registry-only-set-code.fc`; then revert to original
   * (Sender: wallet2) Change admin from wallet2 to wallet1
   * (Sender: wallet1) Set source item code to `...?.fc`; then revert to original
   
   
# License
MIT
