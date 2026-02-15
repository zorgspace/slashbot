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

export const HEADER_HEIGHT = 8; // 1 padding-top + 6 logo + 1 padding-bottom

export interface HeaderIndicator {
  id: string;
  label: string;
  kind: 'connector' | 'service';
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
