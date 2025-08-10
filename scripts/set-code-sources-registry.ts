import { toNano, Address } from "ton-core";
import { SourcesRegistry } from "../wrappers/sources-registry";
import { compile, NetworkProvider } from "@ton-community/blueprint";
import process from "process";
import inquirer from "inquirer";

export async function run(provider: NetworkProvider) {
  try {
    console.log("Compiling sources-registry...");
    const compiled = await compile("sources-registry");
    console.log("Compiled cell:", compiled);

    const codeCellHash = compiled.hash().toString("base64");
    console.log("Code cell hash:", codeCellHash);

    const addressToConfirm = Address.parse("[SOURCES_REGISTRY_ADDRESS]");
    console.log("Address to confirm:", addressToConfirm.toString());

    const sourcesRegistry = provider.open(SourcesRegistry.createFromAddress(addressToConfirm));
    console.log("SourcesRegistry contract opened at:", sourcesRegistry.address.toString());

    const { address } = await inquirer.prompt([
      {
        type: "input",
        name: "address",
        message: `\n\n!!!This will set the code of the Sources Registry contract!!! Proceed with extreme caution!\n\nSources Registry Address: ${addressToConfirm}\nNew Code Cell Hash: ${codeCellHash}\n\nWrite the address of the contract to confirm:`,
      },
    ]);

    try {
      if (!Address.parse(address).equals(addressToConfirm)) {
        console.error("Address does not match, aborting...");
        process.exit(1);
      }
    } catch (e) {
      console.error(`Invalid address: ${address}, aborting...`);
      process.exit(1);
    }

    console.log("Sending changeCode transaction...");
    await sourcesRegistry.sendChangeCode(provider.sender(), {
      newCode: compiled,
      value: toNano("0.05"),
    });

    console.log("Source Registry set code", sourcesRegistry.address.toString());
  } catch (err) {
    console.error("Error during set-code-sources-registry run:", err);
    process.exit(1);
  }
}
