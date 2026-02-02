/**
 * Banner and Logo Components
 */

import { colors } from '../core';

// ASCII Art Skull Logo
export function getLogo(): string {
  return `${colors.violet} ▄▄▄▄▄▄▄
▐░░░░░░░▌
▐░▀░░░▀░▌
▐░░░▄░░░▌
▐░░▀▀▀░░▌
 ▀▀▀▀▀▀▀ ${colors.reset}`;
}

export interface BannerOptions {
  version?: string;
  workingDir?: string;
  contextFile?: string | null;
  tasksCount?: number;
  telegram?: boolean;
  discord?: boolean;
  voice?: boolean;
}

export function banner(options: BannerOptions = {}): string {
  const {
    version = 'v1.0.0',
    workingDir,
    contextFile,
    tasksCount = 0,
    telegram,
    discord,
    voice,
  } = options;
  const cwd = workingDir || process.cwd();
  const shortCwd = cwd.replace(process.env.HOME || '', '~');

  // Build status badges
  const badges: string[] = [];
  if (telegram)
    badges.push(`${colors.green}●${colors.reset} ${colors.muted}Telegram${colors.reset}`);
  if (discord) badges.push(`${colors.green}●${colors.reset} ${colors.muted}Discord${colors.reset}`);
  if (voice) badges.push(`${colors.green}●${colors.reset} ${colors.muted}Voice${colors.reset}`);
  const statusLine = badges.length > 0 ? badges.join('  ') : '';

  // Skull logo - 9 chars wide (space + 7 blocks + space for alignment)
  const logoLines = [
    `${colors.violet} ▄▄▄▄▄▄▄ ${colors.reset}`,
    `${colors.violet}▐░░░░░░░▌${colors.reset}`,
    `${colors.violet}▐░▀░░░▀░▌${colors.reset}`,
    `${colors.violet}▐░░░▄░░░▌${colors.reset}`,
    `${colors.violet}▐░░▀▀▀░░▌${colors.reset}`,
    `${colors.violet} ▀▀▀▀▀▀▀ ${colors.reset}`,
  ];

  const infoLines = [
    `${colors.white}${colors.bold}Slashbot${colors.reset} ${colors.violet}${version}${colors.reset}`,
    `${colors.muted}Grok 4.1 · X.AI · ${shortCwd}${colors.reset}`,
    contextFile ? `${colors.muted}Context: ${contextFile}${colors.reset}` : '',
    statusLine,
    tasksCount > 0 ? `${colors.muted}${tasksCount} scheduled task(s)${colors.reset}` : '',
    `${colors.muted}? help · Tab complete${colors.reset}`,
  ].filter(line => line !== '');

  let result = '\n';
  for (let i = 0; i < Math.max(logoLines.length, infoLines.length); i++) {
    const logoLine = logoLines[i] || '         ';
    const infoLine = infoLines[i] || '';
    result += `${logoLine}  ${infoLine}\n`;
  }

  // Add border
  const width = Math.min(process.stdout.columns || 80, 60);
  result += `${colors.muted}${'─'.repeat(width)}${colors.reset}\n`;

  return result;
}
