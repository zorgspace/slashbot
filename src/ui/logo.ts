import { colors } from './colors';

export function getLogo(): string {
  const width = process.stdout.columns || 80;
  let logo = `${colors.violet}▄`.repeat(width) + '\n';

  const innerLines = ['░░░░░░░', '░▀░░░▀░', '░░░▄░░░', '░░▀▀▀░░'];

  const boxInnerWidth = 9;
  const leftPad = Math.floor((width - boxInnerWidth) / 2);
  const rightPad = width - boxInnerWidth - leftPad;

  for (const inner of innerLines) {
    logo += ' '.repeat(leftPad) + '▐' + inner + '▌' + ' '.repeat(rightPad) + '\n';
  }

  logo += '▀'.repeat(width) + `${colors.reset}`;
  return logo;
}
