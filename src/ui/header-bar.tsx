/**
 * @module ui/header-bar
 *
 * Top status bar component for the Slashbot TUI. Displays the ASCII logo,
 * version, working directory, active provider, busy/ready state, and
 * connector/service status indicators.
 *
 * @see {@link HeaderBar} -- Main component
 * @see {@link HeaderIndicator} -- Indicator data shape
 * @see {@link HEADER_HEIGHT} -- Fixed height constant
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { IndicatorStatus } from '../core/kernel/contracts.js';
import { palette } from './palette.js';

const LOGO_LINES = [
  ' ▄▄▄▄▄▄▄ ',
  '▐░░░░░░░▌',
  '▐░▀░░░▀░▌',
  '▐░░░▄░░░▌',
  '▐░░▀▀▀░░▌',
  ' ▀▀▀▀▀▀▀ ',
];

/** Fixed height of the header bar in terminal rows (1 padding-top + 6 logo + 1 padding-bottom). */
export const HEADER_HEIGHT = 8; // 1 padding-top + 6 logo + 1 padding-bottom

/** Data shape for a status indicator displayed in the header bar. */
export interface HeaderIndicator {
  /** Unique indicator identifier. */
  id: string;
  /** Human-readable label (e.g. 'Telegram', 'Discord'). */
  label: string;
  /** Whether the indicator represents a connector or a service. */
  kind: 'connector' | 'service';
  /** Current status used to determine color and bullet style. */
  status: IndicatorStatus;
}

interface HeaderBarProps {
  cols: number;
  cwd: string;
  busy: boolean;
  indicators?: HeaderIndicator[];
  provider?: string;
}

function indicatorColor(status: IndicatorStatus, kind: 'connector' | 'service'): string {
  if (status === 'connected' || status === 'idle') return palette.success;
  if (status === 'busy' || status === 'running') return palette.warn;
  if (status === 'error') return '#f7768e';
  return palette.dim;
}

function indicatorBullet(status: IndicatorStatus): string {
  if (status === 'disconnected' || status === 'off') return '○';
  return '●';
}

/**
 * Renders the top status bar with the Slashbot logo, version, working
 * directory, provider info, busy/ready indicator, and connector status dots.
 *
 * @param props.cols - Available terminal width.
 * @param props.cwd - Shortened current working directory path.
 * @param props.busy - Whether any agent loop is currently active.
 * @param props.indicators - Status indicators for connectors and services.
 * @param props.provider - Active LLM provider and model label.
 */
export function HeaderBar({ cols, cwd, busy, indicators, provider }: HeaderBarProps) {
  return (
    <Box height={HEADER_HEIGHT} width={cols} flexDirection="row" paddingX={2} paddingY={1}>
      <Box flexDirection="column" width={12}>
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={palette.accent}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" paddingLeft={2} flexGrow={1} justifyContent="center">
        <Text>
          <Text bold color="#c0caf5">SLASHBOT</Text>
          <Text color={palette.accent}> v3.0.0</Text>
        </Text>
        <Text color={palette.muted}>{cwd}</Text>
        <Text color={palette.muted}>{provider ?? 'no provider'}</Text>
        <Text color={palette.muted}>? help · Tab complete</Text>
      </Box>
      <Box flexDirection="column" width={20} alignItems="flex-end">
        {busy ? (
          <Text color={palette.warn}>⋯ busy</Text>
        ) : (
          <Text color={palette.success}>● ready</Text>
        )}
        {indicators?.map((ind) => (
          <Text key={ind.id} color={indicatorColor(ind.status, ind.kind)}>
            {indicatorBullet(ind.status)} {ind.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
