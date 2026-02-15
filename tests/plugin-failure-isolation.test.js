import { describe, expect, test } from 'vitest';
import { SlashbotKernel } from '../src/core/kernel/kernel.js';
describe('Kernel plugin failure isolation', () => {
    test('keeps operational state when one bundled plugin fails registration', async () => {
        const goodManifest = {
            id: 'good.plugin',
            name: 'Good Plugin',
            version: '1.0.0',
            main: 'bundled'
        };
        const badManifest = {
            id: 'bad.plugin',
            name: 'Bad Plugin',
            version: '1.0.0',
            main: 'bundled'
        };
        const kernel = await SlashbotKernel.create({
            workspaceRoot: process.cwd(),
            bundledPlugins: {
                good: () => ({
                    manifest: goodManifest,
                    setup: (context) => {
                        context.registerGatewayMethod({
                            id: 'good.echo',
                            pluginId: 'good.plugin',
                            description: 'echo',
                            handler: async (params) => params
                        });
                    }
                }),
                bad: () => ({
                    manifest: badManifest,
                    setup: () => {
                        throw new Error('simulated plugin setup failure');
                    }
                })
            },
            bundledDiscovered: [
                { manifest: goodManifest, pluginPath: 'bundled:good', source: 'bundled' },
                { manifest: badManifest, pluginPath: 'bundled:bad', source: 'bundled' }
            ]
        });
        const diagnostics = kernel.diagnosticsReport();
        expect(diagnostics.some((entry) => entry.pluginId === 'bad.plugin' && entry.status === 'failed')).toBe(true);
        expect(kernel.gatewayMethods.get('good.echo')).toBeDefined();
        expect(kernel.health().status).toBe('degraded');
    });
});
