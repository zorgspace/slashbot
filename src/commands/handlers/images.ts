/**
 * Image Command Handlers - paste-image, pi
 */

import { step } from '../../ui/display/step';
import type { CommandHandler } from '../registry';

export const pasteImageCommand: CommandHandler = {
  name: 'paste-image',
  description: 'Paste image from system clipboard',
  usage: '/paste-image',
  aliases: ['pi'],
  execute: async () => {
    const { readImageFromClipboard } = await import('../../ui/pasteHandler');
    const { addImage } = await import('../../code/imageBuffer');

    const dataUrl = await readImageFromClipboard();

    if (dataUrl) {
      addImage(dataUrl);
      const sizeKB = Math.round(dataUrl.length / 1024);
      step.image('clipboard', sizeKB);
      step.imageResult();
    } else {
      step.warning('No image in clipboard (install xclip/wl-clipboard on Linux)');
    }
    return true;
  },
};

export const imageHandlers: CommandHandler[] = [pasteImageCommand];
