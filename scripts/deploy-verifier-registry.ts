import { toNano } from '@ton/core';
import { VerifierRegistry } from '../wrappers/verifier-registry';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const verifierRegistry = provider.open(
        VerifierRegistry.createFromConfig(
            await compile('verifier-registry'),
            { verifiers: new Map() },
            0
        )
    );

    await verifierRegistry.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(verifierRegistry.address);

    console.log('Verifier Registry Deployed! address: ', verifierRegistry.address);
}
