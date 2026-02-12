import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_TOKEN,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  isHeartbeatContentEffectivelyEmpty,
  parseDurationOrNull,
  parseHeartbeatResponse,
  stripHeartbeatToken,
} from './types';

describe('stripHeartbeatToken', () => {
  it('skips empty and token-only replies in heartbeat mode', () => {
    expect(stripHeartbeatToken(undefined, { mode: 'heartbeat' })).toEqual({
      shouldSkip: true,
      text: '',
      didStrip: false,
    });
    expect(stripHeartbeatToken('  ', { mode: 'heartbeat' })).toEqual({
      shouldSkip: true,
      text: '',
      didStrip: false,
    });
    expect(stripHeartbeatToken(HEARTBEAT_TOKEN, { mode: 'heartbeat' })).toEqual({
      shouldSkip: true,
      text: '',
      didStrip: true,
    });
  });

  it('drops short acknowledgements in heartbeat mode', () => {
    expect(stripHeartbeatToken('HEARTBEAT_OK ok', { mode: 'heartbeat' })).toEqual({
      shouldSkip: true,
      text: '',
      didStrip: true,
    });
    expect(stripHeartbeatToken(`<b>${HEARTBEAT_TOKEN}</b>`, { mode: 'heartbeat' })).toEqual({
      shouldSkip: true,
      text: '',
      didStrip: true,
    });
  });

  it('keeps long trailing content in heartbeat mode', () => {
    const long = 'A'.repeat(DEFAULT_HEARTBEAT_ACK_MAX_CHARS + 1);
    expect(stripHeartbeatToken(`${long} ${HEARTBEAT_TOKEN}`, { mode: 'heartbeat' })).toEqual({
      shouldSkip: false,
      text: long,
      didStrip: true,
    });
  });

  it('strips only edge tokens in normal message mode', () => {
    expect(stripHeartbeatToken(`${HEARTBEAT_TOKEN} hello`, { mode: 'message' })).toEqual({
      shouldSkip: false,
      text: 'hello',
      didStrip: true,
    });
    expect(stripHeartbeatToken(`hello ${HEARTBEAT_TOKEN}`, { mode: 'message' })).toEqual({
      shouldSkip: false,
      text: 'hello',
      didStrip: true,
    });
    expect(stripHeartbeatToken(`hello ${HEARTBEAT_TOKEN} there`, { mode: 'message' })).toEqual({
      shouldSkip: false,
      text: `hello ${HEARTBEAT_TOKEN} there`,
      didStrip: false,
    });
  });
});

describe('parseHeartbeatResponse', () => {
  it('maps token-only heartbeat replies to ok', () => {
    expect(parseHeartbeatResponse('HEARTBEAT_OK')).toEqual({
      type: 'ok',
      content: '',
      didStripHeartbeatToken: true,
    });
  });

  it('maps non-token replies to alert', () => {
    expect(parseHeartbeatResponse('Investigate failing CI job')).toEqual({
      type: 'alert',
      content: 'Investigate failing CI job',
      didStripHeartbeatToken: false,
    });
  });
});

describe('isHeartbeatContentEffectivelyEmpty', () => {
  it('treats missing file content as non-empty (do not skip)', () => {
    expect(isHeartbeatContentEffectivelyEmpty(undefined)).toBe(false);
    expect(isHeartbeatContentEffectivelyEmpty(null)).toBe(false);
  });

  it('treats header/checklist scaffolding as empty', () => {
    expect(isHeartbeatContentEffectivelyEmpty('# HEARTBEAT.md\n\n## Tasks\n- [ ]\n')).toBe(true);
  });

  it('detects actionable content', () => {
    expect(isHeartbeatContentEffectivelyEmpty('# HEARTBEAT.md\n- [ ] Check logs\n')).toBe(false);
  });
});

describe('parseDurationOrNull', () => {
  it('parses default-minute and chained formats', () => {
    expect(parseDurationOrNull('5', { defaultUnit: 'm' })).toBe(5 * 60_000);
    expect(parseDurationOrNull('2h30m', { defaultUnit: 'm' })).toBe(2 * 60 * 60_000 + 30 * 60_000);
    expect(parseDurationOrNull('90s', { defaultUnit: 'm' })).toBe(90_000);
  });

  it('returns null for invalid values', () => {
    expect(parseDurationOrNull('')).toBeNull();
    expect(parseDurationOrNull('0m')).toBeNull();
    expect(parseDurationOrNull('abc')).toBeNull();
  });
});
