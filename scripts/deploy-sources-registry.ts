import { toNano, Address } from 'ton-core';
import { SourcesRegistry } from '../wrappers/sources-registry';
import { compile, NetworkProvider } from '@ton-community/blueprint';
import { zeroAddress } from '../test/unit/helpers';

export async function run(provider: NetworkProvider) {
    const sourcesRegistry = provider.open(
        SourcesRegistry.create(
            {
                verifierRegistryAddress: zeroAddress,
                admin: Address.parse("EQBnLd2ta0Od6LkhaeO1zDQ4wcvoUReK8Z8k881BIMrTfjb8"),
                maxTons: toNano("1.1"),
                minTons: toNano("0.065"),
                sourceItemCode: await compile('source-item')
            }, 
            await compile('sources-registry')
        )
    );

    await sourcesRegistry.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(sourcesRegistry.address);

    console.log('Source Registry Deployed! address: ', sourcesRegistry.address);
}
