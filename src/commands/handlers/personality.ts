/**
 * Personality Command Handlers - depressed, sarcasm, normal, unhinged
 */

import { c, colors } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const depressedCommand: CommandHandler = {
  name: 'depressed',
  description: 'Enable depressed bot mode',
  usage: '/depressed',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'depressed') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('*sigh* Fine, back to normal... not that it matters...'));
    } else {
      context.grokClient.setPersonality('depressed');
      console.log(c.muted('*sigh* Depressed mode enabled... everything is meaningless anyway...'));
    }
    return true;
  },
};

export const sarcasmCommand: CommandHandler = {
  name: 'sarcasm',
  description: 'Enable sarcastic bot mode',
  usage: '/sarcasm',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'sarcasm') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('Oh, you want me to be nice now? How refreshing.'));
    } else {
      context.grokClient.setPersonality('sarcasm');
      console.log(c.warning('Sarcasm mode enabled. This is going to be fun. 🙄'));
    }
    return true;
  },
};

export const normalCommand: CommandHandler = {
  name: 'normal',
  description: 'Reset to normal bot mode',
  usage: '/normal',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    context.grokClient.setPersonality('normal');
    console.log(c.success('Back to normal mode'));
    return true;
  },
};

export const unhingedCommand: CommandHandler = {
  name: 'unhinged',
  description: 'Toggle unhinged mode (chaotic responses)',
  usage: '/unhinged',
  execute: async (_, context) => {
    if (!context.grokClient) {
      console.log(c.error('GrokClient not available'));
      return true;
    }

    const current = context.grokClient.getPersonality();
    if (current === 'unhinged') {
      context.grokClient.setPersonality('normal');
      console.log(c.success('Sanity restored. Back to boring mode.'));
    } else {
      context.grokClient.setPersonality('unhinged');
      console.log(colors.violet + 'UNHINGED MODE ACTIVATED - Chaos unleashed! 🔥' + '\x1b[0m');
    }
    return true;
  },
};

export const personalityHandlers: CommandHandler[] = [
  depressedCommand,
  sarcasmCommand,
  normalCommand,
  unhingedCommand,
];
