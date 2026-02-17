/**
 * @module ui/hooks
 *
 * Custom React hooks for the Slashbot TUI. Provides terminal-aware
 * utilities built on top of Ink's stdout access.
 *
 * @see {@link useTerminalSize} -- Reactive terminal dimensions hook
 */
import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

/**
 * Hook that tracks the current terminal dimensions and re-renders
 * whenever the terminal is resized.
 *
 * @returns An object with the current `rows` and `cols` of the terminal.
 */
export function useTerminalSize(): { rows: number; cols: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });

  useEffect(() => {
    const onResize = () => {
      setSize({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
