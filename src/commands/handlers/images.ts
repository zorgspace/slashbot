/**
 * Image Command Handlers - paste-image, pi
 */

import { c } from '../../ui/colors';
import type { CommandHandler } from '../registry';

export const pasteImageCommand: CommandHandler = {
  name: 'paste-image',
  description: 'Paste image from system clipboard',
  usage: '/paste-image',
  aliases: ['pi'],
  execute: async () => {
    const { readImageFromClipboard } = await import('../../ui/pasteHandler');
    const { addImage } = await import('../../code/imageBuffer');

    console.log(c.muted('Reading clipboard...'));
    const dataUrl = await readImageFromClipboard();

    if (dataUrl) {
      addImage(dataUrl);
      const sizeKB = Math.round(dataUrl.length / 1024);
      console.log(c.success(`🖼️  Image pasted from clipboard (${sizeKB}KB)`));
      console.log(c.muted('   Now ask a question about the image'));
    } else {
      console.log(c.warning('No image found in clipboard'));
      console.log(c.muted('   Linux: install xclip (X11) or wl-clipboard (Wayland)'));
      console.log(c.muted('   Copy an image to clipboard first'));
    }
    return true;
  },
};

export const imageHandlers: CommandHandler[] = [pasteImageCommand];
