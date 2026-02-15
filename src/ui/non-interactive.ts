import type { SlashbotKernel } from '../core/kernel/kernel.js';
import { KernelLlmAdapter } from '../core/agentic/llm/index.js';
import type { TokenModeProxyAuthService } from '../core/agentic/llm/index.js';
import type { StructuredLogger } from '../core/kernel/contracts.js';
import type { ProviderRegistry } from '../core/kernel/registries.js';
import type { AuthProfileRouter } from '../core/providers/auth-router.js';

export async function runSinglePromptNonInteractive(
  kernel: SlashbotKernel,
  input: string,
  sessionId: string,
  agentId: string
): Promise<number> {
  const prompt = input.trim();
  if (!prompt) {
    process.stderr.write('Prompt cannot be empty in non-interactive mode.\n');
    return 1;
  }

  const authRouter = kernel.services.get<AuthProfileRouter>('kernel.authRouter');
  const providers = kernel.services.get<ProviderRegistry>('kernel.providers.registry');
  const logger = kernel.services.get<StructuredLogger>('kernel.logger') ?? kernel.logger;
  if (!authRouter || !providers) {
    process.stderr.write('LLM adapter unavailable. Configure a provider/API key.\n');
    return 1;
  }

  const llm = new KernelLlmAdapter(
    authRouter,
    providers,
    logger,
    kernel,
    () => kernel.services.get<TokenModeProxyAuthService>('wallet.proxyAuth'),
  );

  await kernel.sendMessageLifecycle('message_received', sessionId, agentId, prompt);
  await kernel.sendMessageLifecycle('message_sending', sessionId, agentId, prompt);

  let responseText = '';
  try {
    const systemPrompt = await kernel.assemblePrompt();
    const result = await llm.complete(
      {
        sessionId,
        agentId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      },
      {
        onToolStart: (action) => process.stderr.write(`  → ${action.name}...\n`),
        onToolEnd: (action) => {
          if (action.error) process.stderr.write(`  ✗ ${action.name}: ${action.error}\n`);
        },
      },
    );
    responseText = result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    await kernel.sendMessageLifecycle('message_sent', sessionId, agentId, message);
    return 2;
  }

  if (responseText.trim().length > 0) {
    process.stdout.write(`${responseText}\n`);
  }
  await kernel.sendMessageLifecycle('message_sent', sessionId, agentId, responseText);
  return 0;
}
