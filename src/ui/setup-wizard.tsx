import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Link from 'ink-link';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { AuthCompleteInput, AuthStartResult, ProviderAuthMethod, ProviderDefinition } from '../core/kernel/contracts.js';
import type { SlashbotKernel } from '../core/kernel/kernel.js';
import { ensureBaseConfig } from './onboarding.js';

type SetupStage = 'provider' | 'method' | 'credential' | 'oauth_code' | 'oauth_state' | 'done';

interface SetupWizardProps {
  kernel: SlashbotKernel;
  agentId: string;
  onComplete: (summary: string) => void;
}

const wizardPalette = {
  accent: '#A584E3',
  text: '#D7DCE5',
  muted: '#8A92A0',
  warn: '#F2C66D',
  error: '#F08181',
  success: '#87D68D'
};
const BUSY_SPINNER_TYPE = 'simpleDots';

function authMethodLabel(method: ProviderAuthMethod): string {
  switch (method) {
    case 'api_key':
      return 'API key';
    case 'oauth_pkce':
      return 'OAuth PKCE';
    case 'setup_token':
      return 'Setup token';
    case 'claude_code_import':
      return 'Import Claude Code credentials';
    default:
      return method;
  }
}

function authMethodDescription(method: ProviderAuthMethod): string {
  switch (method) {
    case 'api_key':
      return 'Fast path: paste the provider API key.';
    case 'oauth_pkce':
      return 'Browser flow with auth URL, then paste code/state.';
    case 'setup_token':
      return 'Use a one-time setup token and exchange it.';
    case 'claude_code_import':
      return 'Import local Claude Code credentials if present.';
    default:
      return '';
  }
}

function stageNumber(stage: SetupStage): number {
  switch (stage) {
    case 'provider':
      return 1;
    case 'method':
      return 2;
    case 'credential':
    case 'oauth_code':
    case 'oauth_state':
      return 3;
    case 'done':
      return 4;
    default:
      return 1;
  }
}

function findMethodHandler(provider: ProviderDefinition, method: ProviderAuthMethod) {
  return provider.authHandlers.find((handler) => handler.method === method);
}

export function SetupWizard(props: SetupWizardProps): React.ReactElement {
  const { kernel, agentId, onComplete } = props;
  const providers = useMemo(() => kernel.providers.list().sort((a, b) => a.displayName.localeCompare(b.displayName)), [kernel]);
  const [stage, setStage] = useState<SetupStage>('provider');
  const [providerIndex, setProviderIndex] = useState(0);
  const [methodIndex, setMethodIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [hint, setHint] = useState<string | undefined>();
  const [startResult, setStartResult] = useState<AuthStartResult | undefined>();
  const [credentialValue, setCredentialValue] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthState, setOauthState] = useState('');

  const selectedProvider = providers[providerIndex];
  const methods = selectedProvider?.authHandlers.map((handler) => handler.method) ?? [];
  const selectedMethod = methods[methodIndex];

  useEffect(() => {
    void ensureBaseConfig().catch((cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Failed to initialize Slashbot config: ${message}`);
    });
  }, []);

  useEffect(() => {
    if (methodIndex >= methods.length) {
      setMethodIndex(0);
    }
  }, [methodIndex, methods.length]);

  const completeSetup = useCallback(
    async (input: AuthCompleteInput) => {
      if (!selectedProvider || !selectedMethod) {
        return;
      }

      const handler = findMethodHandler(selectedProvider, selectedMethod);
      if (!handler) {
        setError(`Selected auth method is unavailable: ${selectedMethod}`);
        return;
      }

      setBusy(true);
      setError(undefined);
      setStatus('Saving profile...');

      try {
        const profileLabel = `${selectedProvider.displayName} profile`;
        const profile = await handler.complete(
          {
            agentId,
            profileLabel,
            nonInteractive: false,
            redirectUri: selectedMethod === 'oauth_pkce' ? 'http://127.0.0.1:8787/callback' : undefined
          },
          input
        );

        await kernel.authStore.upsertProfile(agentId, profile);
        setStatus(`Profile saved: ${profile.providerId}/${profile.profileId}`);
        setStage('done');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [agentId, kernel.authStore, selectedMethod, selectedProvider]
  );

  const startMethodFlow = useCallback(async () => {
    if (!selectedProvider || !selectedMethod) {
      return;
    }

    const handler = findMethodHandler(selectedProvider, selectedMethod);
    if (!handler) {
      setError(`Selected auth method is unavailable: ${selectedMethod}`);
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus('Preparing auth flow...');

    try {
      const profileLabel = `${selectedProvider.displayName} profile`;
      const started = await handler.start({
        agentId,
        profileLabel,
        nonInteractive: false,
        redirectUri: selectedMethod === 'oauth_pkce' ? 'http://127.0.0.1:8787/callback' : undefined
      });

      setStartResult(started);
      setHint(started.instructions);

      if (selectedMethod === 'api_key' || selectedMethod === 'setup_token') {
        setCredentialValue('');
        setStage('credential');
        return;
      }

      if (selectedMethod === 'oauth_pkce') {
        setOauthCode('');
        setOauthState(started.state ?? '');
        setStage('oauth_code');
        return;
      }

      await completeSetup({});
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [agentId, completeSetup, selectedMethod, selectedProvider]);

  useInput((input, key) => {
    if (busy || providers.length === 0) {
      return;
    }

    if (stage === 'provider') {
      if (key.downArrow) {
        setProviderIndex((index) => Math.min(index + 1, providers.length - 1));
      } else if (key.upArrow) {
        setProviderIndex((index) => Math.max(index - 1, 0));
      } else if (key.return) {
        setError(undefined);
        setHint(undefined);
        setStage('method');
        setMethodIndex(0);
      }
      return;
    }

    if (stage === 'method') {
      if (key.downArrow) {
        setMethodIndex((index) => Math.min(index + 1, Math.max(methods.length - 1, 0)));
      } else if (key.upArrow) {
        setMethodIndex((index) => Math.max(index - 1, 0));
      } else if (key.escape) {
        setStage('provider');
        setError(undefined);
        setHint(undefined);
      } else if (key.return) {
        void startMethodFlow();
      }
      return;
    }

    if (stage === 'credential' || stage === 'oauth_code' || stage === 'oauth_state') {
      if (key.escape) {
        setStage('method');
        setError(undefined);
        setHint(undefined);
        setCredentialValue('');
        setOauthCode('');
        setOauthState('');
        setStartResult(undefined);
      }
      return;
    }

    if (stage === 'done' && key.return) {
      onComplete(status || 'Setup complete');
    }
  });

  if (providers.length === 0) {
    return (
      <Box borderStyle="round" borderColor={wizardPalette.error} paddingX={2} paddingY={1} flexDirection="column">
        <Text bold color={wizardPalette.error}>
          Setup unavailable
        </Text>
        <Text color={wizardPalette.text}>No auth providers are registered. Run `slashbot doctor` for diagnostics.</Text>
      </Box>
    );
  }

  const credentialLabel = selectedMethod === 'setup_token' ? 'Setup token' : 'API key';
  const isDone = stage === 'done';

  return (
    <Box borderStyle="round" borderColor={wizardPalette.accent} paddingX={2} paddingY={1} flexDirection="column">
      <Text bold color={wizardPalette.text}>
        First-run setup
      </Text>
      <Text color={wizardPalette.muted}>No Slashbot config file was found. Complete this quick guided setup.</Text>
      <Text color={wizardPalette.accent}>
        Step {stageNumber(stage)} / 4
      </Text>

      {stage === 'provider' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.text}>Choose your provider (Up/Down, Enter):</Text>
          {providers.map((provider, index) => (
            <Text key={provider.id} color={index === providerIndex ? wizardPalette.accent : wizardPalette.muted}>
              {index === providerIndex ? '> ' : '  '}
              {provider.displayName} ({provider.id})
            </Text>
          ))}
        </Box>
      )}

      {stage === 'method' && selectedProvider && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.text}>
            {selectedProvider.displayName}: choose auth method (Up/Down, Enter, Esc to go back):
          </Text>
          {methods.map((method, index) => (
            <Text key={`${selectedProvider.id}-${method}`} color={index === methodIndex ? wizardPalette.accent : wizardPalette.muted}>
              {index === methodIndex ? '> ' : '  '}
              {authMethodLabel(method)} - {authMethodDescription(method)}
            </Text>
          ))}
        </Box>
      )}

      {stage === 'credential' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.text}>
            Enter {credentialLabel} and press Enter (Esc to go back):
          </Text>
          <TextInput
            value={credentialValue}
            onChange={setCredentialValue}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!trimmed) {
                setError(`${credentialLabel} cannot be empty.`);
                return;
              }

              if (selectedMethod === 'setup_token') {
                void completeSetup({ setupToken: trimmed });
              } else {
                void completeSetup({ apiKey: trimmed });
              }
            }}
            focus={!busy}
            mask="*"
            placeholder={`Paste ${credentialLabel.toLowerCase()}`}
          />
        </Box>
      )}

      {stage === 'oauth_code' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.warn}>Open auth URL in browser, approve access, then paste the code.</Text>
          {startResult?.authUrl ? (
            <Link url={startResult.authUrl}>
              <Text color={wizardPalette.accent}>Open authentication page</Text>
            </Link>
          ) : null}
          <Text color={wizardPalette.text}>OAuth code (Esc to go back):</Text>
          <TextInput
            value={oauthCode}
            onChange={setOauthCode}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!trimmed) {
                setError('OAuth code cannot be empty.');
                return;
              }
              setError(undefined);
              setOauthCode(trimmed);
              setStage('oauth_state');
            }}
            focus={!busy}
            placeholder="Paste OAuth code"
          />
        </Box>
      )}

      {stage === 'oauth_state' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.text}>OAuth state (press Enter to keep suggested value):</Text>
          <TextInput
            value={oauthState}
            onChange={setOauthState}
            onSubmit={(value) => {
              const state = value.trim() || startResult?.state;
              void completeSetup({ code: oauthCode.trim(), state });
            }}
            focus={!busy}
            placeholder={startResult?.state ? `Default: ${startResult.state}` : 'Paste OAuth state'}
          />
        </Box>
      )}

      {isDone && (
        <Box marginTop={1} flexDirection="column">
          <Text color={wizardPalette.success}>{status}</Text>
          <Text color={wizardPalette.muted}>Press Enter to continue to chat.</Text>
        </Box>
      )}

      {hint ? (
        <Box marginTop={1}>
          <Text color={wizardPalette.muted}>{hint}</Text>
        </Box>
      ) : null}

      {busy ? (
        <Box marginTop={1}>
          <Text color={wizardPalette.muted}><Spinner type={BUSY_SPINNER_TYPE} /> {status || 'Working...'}</Text>
        </Box>
      ) : null}

      {error ? (
        <Box marginTop={1}>
          <Text color={wizardPalette.error}>Error: {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
