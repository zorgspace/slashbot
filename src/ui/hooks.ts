import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

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
