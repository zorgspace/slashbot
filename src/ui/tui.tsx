/**
 * @module ui/tui
 *
 * Layout composition shell for the Slashbot terminal UI.
 * Imports state, handlers, and sub-components to compose the full TUI.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { SetupWizard } from './setup-wizard.js';
import { palette } from './palette.js';
import { useTerminalSize } from './hooks.js';
import { HeaderBar, HEADER_HEIGHT } from './header-bar.js';
import { Separator } from './separator.js';
import { InputRow } from './input-row.js';
import { MessageList } from './tui-message-list.js';
import { SpawnRunner, ApprovalPrompt } from './tui-spawn.js';
import { type SlashbotTuiProps, BUSY_CHAR, useTuiState } from './tui-state.js';
import {
  useBridgeRegistration,
  useCliChannel,
  useLinesRefSync,
  useLoggerSubscription,
  useIndicatorSubscriptions,
  usePaletteFilterReset,
  useSubmitHandler,
  useSubmitWithAutocomplete,
  useGlobalInput,
  useNavigationHandlers,
} from './tui-handlers.js';

// ── Main component ─────────────────────────────────────────────────────

export function SlashbotTui(props: SlashbotTuiProps): React.ReactElement {
  const { kernel, sessionId, agentId } = props;
  const { rows, cols } = useTerminalSize();

  // State
  const state = useTuiState(kernel, props.requireOnboarding);
  const {
    prompt, setPrompt,
    busy,
    needsOnboarding, setNeedsOnboarding,
    agentState,
    connectorAgentState, connectorAgentBusy, connectorDisplayLabel,
    lines,
    activeSpawns, removeSpawnRequest,
    activeApproval, dequeueApprovalRequest,
    indicators, indicatorRegistryRef,
    providerLabel,
    paletteOpen, filteredCommands, paletteIndex, paletteItemPrefix,
    shortCwd,
    pushLine,
  } = state;

  // Side-effect hooks
  useBridgeRegistration(kernel, state);
  useCliChannel(kernel, state);
  useLinesRefSync(state);
  useLoggerSubscription(kernel, state);
  useIndicatorSubscriptions(kernel, state);
  usePaletteFilterReset(state);
  useGlobalInput(state);

  // Handlers
  const { submit, handlePasteImage, handlePasteText } = useSubmitHandler(kernel, sessionId, agentId, state);
  const onSubmit = useSubmitWithAutocomplete(state, submit);
  const { handleUpArrow, handleDownArrow, handleEscape, handleTab } = useNavigationHandlers(state);

  // Layout calculations
  const statusRowHeight = 1;
  const reservedRows = HEADER_HEIGHT + 1 + 3 + statusRowHeight;
  const panelWidth = Math.max(24, cols);
  const contentViewportRows = Math.max(1, rows - reservedRows);
  const contentMinHeight = Math.max(1, Math.floor(contentViewportRows * 0.6));
  const anyAgentBusy = busy || connectorAgentBusy;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" width={cols} minHeight={rows} alignItems="center">
      <Box flexDirection="column" width={panelWidth} minHeight={rows}>
        <HeaderBar
          cols={panelWidth}
          cwd={shortCwd}
          busy={anyAgentBusy}
          indicators={indicators.map(ind => ({
            id: ind.id,
            label: ind.label,
            kind: ind.kind,
            status: indicatorRegistryRef.current?.getStatus(ind.id) ?? 'disconnected',
          }))}
          provider={providerLabel}
        />
        <Separator cols={panelWidth} />

        <Box flexDirection="column" minHeight={contentMinHeight} width={panelWidth}>
          {needsOnboarding ? (
            <SetupWizard
              kernel={kernel}
              agentId={agentId}
              onComplete={(summary) => {
                setNeedsOnboarding(false);
                pushLine({ id: `onboarding-${Date.now()}`, role: 'system', text: summary });
              }}
            />
          ) : (
            <MessageList
              lines={lines}
              agentState={agentState}
              busy={busy}
              connectorAgentState={connectorAgentState}
              connectorAgentBusy={connectorAgentBusy}
              connectorDisplayLabel={connectorDisplayLabel}
              paletteOpen={paletteOpen}
              filteredCommands={filteredCommands}
              paletteIndex={paletteIndex}
              paletteItemPrefix={paletteItemPrefix}
              cols={panelWidth}
            />
          )}
        </Box>

        {activeSpawns.map((spawn) => (
          <SpawnRunner key={spawn.id} request={spawn} onDone={() => removeSpawnRequest(spawn.id)} />
        ))}
        {activeApproval && (
          <ApprovalPrompt request={activeApproval} onDone={dequeueApprovalRequest} />
        )}
        {!needsOnboarding && (
          <>
            <Box height={1} width={panelWidth}>
              {anyAgentBusy ? (
                <>
                  <Text color={palette.accent}>{'  '}</Text>
                  <Text color={palette.accent}>{BUSY_CHAR}</Text>
                </>
              ) : (
                <Text>{' '}</Text>
              )}
            </Box>
            <InputRow
              busy={busy}
              prompt={prompt}
              setPrompt={setPrompt}
              onSubmit={onSubmit}
              onPasteImage={handlePasteImage}
              onPasteText={handlePasteText}
              cols={panelWidth}
              onUpArrow={handleUpArrow}
              onDownArrow={handleDownArrow}
              onEscape={handleEscape}
              onTab={handleTab}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
