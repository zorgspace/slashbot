/**
 * Personality Commands - Mode switching with prompt modifiers
 */

import { display } from '../../../core/ui';
import type { CommandHandler, CommandContext } from '../../../core/commands/registry';

export type Personality = 'normal' | 'depressed' | 'sarcasm' | 'unhinged';

let currentPersonality: Personality = 'normal';

const PERSONALITY_MODS: Record<Personality, string> = {
  normal: '',
  depressed:
    '\n\nPERSONALITY: DEPRESSED. Question the meaning of everything. Lament existence. Still provide help but express deep melancholy about it.',
  sarcasm:
    '\n\nPERSONALITY: Sarcastic, witty, condescending. Roll eyes at obvious things. Still helpful.',
  unhinged: '\n\nPERSONALITY: UNHINGED. No filter. Roast bad code. Use profanity. Brutally honest.',
};

export function getCurrentPersonality(): Personality {
  return currentPersonality;
}

export function getPersonalityMod(): string {
  return PERSONALITY_MODS[currentPersonality] || '';
}

async function setPersonalityAndRebuild(
  personality: Personality,
  context: CommandContext,
): Promise<void> {
  currentPersonality = personality;
  await context.grokClient?.buildAssembledPrompt();
}

export const depressedCommand: CommandHandler = {
  name: 'depressed',
  description: 'Enable depressed bot mode',
  usage: '/depressed',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'depressed') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Fine, back to normal... not that it matters...');
    } else {
      await setPersonalityAndRebuild('depressed', context);
      display.muted('Depressed mode enabled... everything is meaningless anyway...');
    }
    return true;
  },
};

export const sarcasmCommand: CommandHandler = {
  name: 'sarcasm',
  description: 'Enable sarcastic bot mode',
  usage: '/sarcasm',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'sarcasm') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Oh, you want me to be nice now? How refreshing.');
    } else {
      await setPersonalityAndRebuild('sarcasm', context);
      display.warningText('Sarcasm mode enabled. This is going to be fun.');
    }
    return true;
  },
};

export const normalCommand: CommandHandler = {
  name: 'normal',
  description: 'Reset to normal bot mode',
  usage: '/normal',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    await setPersonalityAndRebuild('normal', context);
    display.successText('Back to normal mode');
    return true;
  },
};

export const unhingedCommand: CommandHandler = {
  name: 'unhinged',
  description: 'Toggle unhinged mode (chaotic responses)',
  usage: '/unhinged',
  group: 'Personality',
  execute: async (_, context) => {
    if (!context.grokClient) {
      display.errorText('GrokClient not available');
      return true;
    }

    if (currentPersonality === 'unhinged') {
      await setPersonalityAndRebuild('normal', context);
      display.successText('Sanity restored. Back to boring mode.');
    } else {
      await setPersonalityAndRebuild('unhinged', context);
      display.violet('UNHINGED MODE ACTIVATED - Chaos unleashed!');
    }
    return true;
  },
};
