/**
 * @module ui/tui-spawn
 *
 * Invisible process management components for the TUI.
 * SpawnRunner manages ink-spawn lifecycle for shell commands.
 * ApprovalPrompt renders interactive y/n for risky commands.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Writable } from 'node:stream';
import { Box, Text, useInput } from 'ink';
import { useSpawn } from 'ink-spawn';
import type { SpawnRequest } from '../core/kernel/spawn-bridge.js';
import type { ApprovalRequest } from '../core/kernel/approval-bridge.js';
import { commandExists } from '../core/kernel/safe-command.js';

// ── SpawnRunner (invisible, manages ink-spawn lifecycle) ───────────────

const SPAWN_MAX_OUTPUT = 10_000;

function truncateSpawnOutput(text: string): string {
  if (text.length <= SPAWN_MAX_OUTPUT) return text;
  return `${text.slice(0, SPAWN_MAX_OUTPUT)}\n... (truncated, ${text.length - SPAWN_MAX_OUTPUT} more chars)`;
}

export function SpawnRunner({ request, onDone }: { request: SpawnRequest; onDone: () => void }) {
  const stdoutRef = useRef('');
  const stderrRef = useRef('');
  const resolvedRef = useRef(false);

  const resolve = useCallback((result: Parameters<SpawnRequest['resolve']>[0]) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve(result);
    onDone();
  }, [request, onDone]);

  const { spawn } = useSpawn((error) => {
    const truncOut = truncateSpawnOutput(stdoutRef.current);
    const truncErr = truncateSpawnOutput(stderrRef.current);
    if (error) {
      resolve({
        ok: false,
        output: truncOut,
        error: { code: 'COMMAND_FAILED', message: `Command exited with code ${error.code ?? 'unknown'}` },
        metadata: { stdout: truncOut, stderr: truncErr, code: error.code ?? -1 },
      });
    } else {
      resolve({
        ok: true,
        output: truncOut,
        metadata: { stdout: truncOut, stderr: truncErr, code: 0 },
      });
    }
  });

  const stdout = useMemo(() => new Writable({
    write(chunk, _enc, cb) { stdoutRef.current += chunk.toString(); cb(); },
  }), []);

  const stderr = useMemo(() => new Writable({
    write(chunk, _enc, cb) { stderrRef.current += chunk.toString(); cb(); },
  }), []);

  useEffect(() => {
    // Guard against ENOENT crash: ink-spawn throws (crashes process) on
    // non-SpawnFailure errors.  Resolve gracefully if binary is missing.
    if (!commandExists(request.command)) {
      resolve({
        ok: false,
        error: {
          code: 'COMMAND_NOT_FOUND',
          message: `Command not found: "${request.command}" is not installed on this system.`,
        },
      });
      return;
    }

    try {
      spawn(request.command, request.args, {
        cwd: request.cwd,
        stdout,
        stderr,
        outputMode: 'inherit',
      });
    } catch (err) {
      resolve({
        ok: false,
        error: {
          code: 'SPAWN_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    const timer = setTimeout(() => {
      resolve({
        ok: false,
        error: { code: 'COMMAND_TIMEOUT', message: `Timed out after ${request.timeoutMs}ms` },
        metadata: { stdout: truncateSpawnOutput(stdoutRef.current), stderr: truncateSpawnOutput(stderrRef.current) },
      });
    }, request.timeoutMs);

    // Listen for abort signal to kill early
    const onAbort = () => {
      resolve({
        ok: false,
        error: { code: 'COMMAND_CANCELLED', message: 'Cancelled by user' },
        metadata: { stdout: truncateSpawnOutput(stdoutRef.current), stderr: truncateSpawnOutput(stderrRef.current) },
      });
    };
    request.abortSignal?.addEventListener('abort', onAbort, { once: true });

    return () => {
      clearTimeout(timer);
      request.abortSignal?.removeEventListener('abort', onAbort);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ── ApprovalPrompt (renders interactive y/n for risky commands) ────────

export function ApprovalPrompt({ request, onDone }: { request: ApprovalRequest; onDone: () => void }) {
  const resolvedRef = useRef(false);
  const fullCommand = [request.command, ...request.args].join(' ');

  useInput((input, key) => {
    if (resolvedRef.current) return;

    if (input === 'y' || input === 'Y') {
      resolvedRef.current = true;
      // Approve: resolve with a special marker so the tool can re-execute
      request.resolve({
        ok: true,
        output: 'APPROVED',
        metadata: { approved: true, command: request.command, args: request.args, cwd: request.cwd },
      });
      onDone();
    } else if (input === 'n' || input === 'N' || key.escape) {
      resolvedRef.current = true;
      request.resolve({
        ok: false,
        error: { code: 'APPROVAL_DENIED', message: `User denied execution of: ${fullCommand}` },
      });
      onDone();
    }
  });

  return (
    <Box>
      <Box marginRight={1}>
        <Text>{`\u26A0\uFE0F  Allow \`${fullCommand}\`? [y/n]`}</Text>
      </Box>
    </Box>
  );
}
