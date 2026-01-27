import { colors } from './colors';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export async function withSpinner<T>(message: string, cb: () => Promise<T>): Promise<T> {
  let frameIndex = 0;
  const lineLength = message.length + 6;

  const interval = setInterval(() => {
    const frame = frames[frameIndex % frames.length];
    process.stdout.write(`\r${colors.violetLight}${colors.bold}${frame} ${message}...${colors.reset}`);
    frameIndex++;
  }, 80);

  try {
    const result = await cb();
    clearInterval(interval);
    process.stdout.write(`\r${' '.repeat(lineLength)}\r`);
    return result;
  } catch (error) {
    clearInterval(interval);
    process.stdout.write(`\r${' '.repeat(lineLength)}\r`);
    throw error;
  }
}
