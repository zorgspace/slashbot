import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Kernel } from './core/kernel.js';

export function App({ kernel }: { kernel: Kernel }) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('Type "help" then press Enter.');

  useInput(async (value, key) => {
    if (key.return) {
      const result = await kernel.executeCommand(input);
      if (result) {
        setOutput(result);
      }
      setInput('');
      return;
    }

    if (key.backspace || key.delete) {
      setInput(current => current.slice(0, -1));
      return;
    }

    if (value) {
      setInput(current => current + value);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan">Ink Plugin-Ready CLI</Text>
      <Text>{output}</Text>
      <Box marginTop={1}>
        <Text color="green">&gt; </Text>
        <Text>{input}</Text>
      </Box>
    </Box>
  );
}
