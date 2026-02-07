/**
 * Terminal Input Utilities
 */

/**
 * Prompt for password (hidden input)
 */
export async function promptPassword(prompt: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    let password = '';

    // Enable raw mode for hidden input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Enter - submit
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(password);
      }
      // Ctrl+C - cancel
      else if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
      }
      // Backspace
      else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      }
      // Regular character
      else if (char.length === 1 && char >= ' ') {
        password += char;
        process.stdout.write('*');
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdin.on('data', onKeyPress);
  });
}
