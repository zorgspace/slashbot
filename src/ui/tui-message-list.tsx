/**
 * @module ui/tui-message-list
 *
 * Message rendering component for the SlashbotTui.
 * Displays conversation messages, agent activity indicators, and the command palette.
 */

import React from 'react';
import type { ChatLine } from './palette.js';
import type { AgentLoopDisplayState } from './agent-activity.js';
import { MessageLine } from './message-line.js';
import { AgentActivity } from './agent-activity.js';
import { CommandPalette } from './command-palette.js';

export interface MessageListProps {
  lines: ChatLine[];
  agentState: AgentLoopDisplayState;
  busy: boolean;
  connectorAgentState: AgentLoopDisplayState;
  connectorAgentBusy: boolean;
  connectorDisplayLabel: string;
  paletteOpen: boolean;
  filteredCommands: Array<{ id: string; description: string }>;
  paletteIndex: number;
  paletteItemPrefix: string;
  cols: number;
}

export function MessageList({
  lines,
  agentState,
  busy,
  connectorAgentState,
  connectorAgentBusy,
  connectorDisplayLabel,
  paletteOpen,
  filteredCommands,
  paletteIndex,
  paletteItemPrefix,
  cols,
}: MessageListProps): React.ReactElement {
  return (
    <>
      {lines.map((line) => (
        <MessageLine key={line.id} line={line} cols={cols} />
      ))}
      <AgentActivity state={agentState} busy={busy} cols={cols} displayLabel="Agent" />
      <AgentActivity state={connectorAgentState} busy={connectorAgentBusy} cols={cols} displayLabel={connectorDisplayLabel || undefined} />
      {paletteOpen && filteredCommands.length > 0 && (
        <CommandPalette
          commands={filteredCommands}
          selectedIndex={paletteIndex}
          cols={cols}
          prefix={paletteItemPrefix}
        />
      )}
    </>
  );
}
