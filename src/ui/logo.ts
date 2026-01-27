import { colors } from './colors';

export function getLogo(): string {
  return `${colors.violet} ▄▄▄▄▄▄▄
▐░░░░░░░▌
▐░▀░░░▀░▌
▐░░░▄░░░▌
▐░░▀▀▀░░▌
 ▀▀▀▀▀▀▀${colors.reset}`;
}
