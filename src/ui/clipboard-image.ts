/**
 * @module ui/clipboard-image
 *
 * Cross-platform clipboard access for image and text paste in the TUI.
 * Supports macOS (pngpaste / pbpaste), Linux Wayland (wl-paste),
 * and Linux X11 (xclip). Images are returned as base64 data URLs.
 *
 * @see {@link readClipboardImageData} -- Read image from clipboard
 * @see {@link readClipboardText} -- Read text from clipboard
 * @see {@link ClipboardImageData} -- Image data structure
 */
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

const IMAGE_MIME_CANDIDATES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface CommandResult {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
  code: number | null;
  notFound: boolean;
}

/** Data returned when an image is read from the system clipboard. */
export interface ClipboardImageData {
  /** Base64-encoded data URL of the image. */
  dataUrl: string;
  /** MIME type of the image (e.g. image/png). */
  mimeType: string;
  /** Size of the image in bytes. */
  bytes: number;
  /** Platform source: 'macos', 'wayland', or 'x11'. */
  source: string;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let notFound = false;

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        notFound = true;
      } else {
        stderr += error.message;
      }
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0 && !notFound,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderr.trim(),
        code,
        notFound,
      });
    });
  });
}

function parseMimeTypes(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function pickMimeType(types: string[]): string | undefined {
  return IMAGE_MIME_CANDIDATES.find((candidate) => types.includes(candidate));
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function ensureImageBuffer(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new Error('Clipboard does not contain image bytes.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Clipboard image too large (${Math.round(buffer.length / 1024 / 1024)}MB, max 10MB).`);
  }
}

async function readWaylandImage(): Promise<ClipboardImageData | null> {
  const list = await runCommand('wl-paste', ['--list-types']);
  if (list.notFound || !list.ok) return null;

  const mimeType = pickMimeType(parseMimeTypes(list.stdout.toString('utf8')));
  if (!mimeType) return null;

  const image = await runCommand('wl-paste', ['--no-newline', '--type', mimeType]);
  if (!image.ok) {
    throw new Error(image.stderr || 'Failed to read image from Wayland clipboard.');
  }

  ensureImageBuffer(image.stdout);
  return {
    dataUrl: toDataUrl(image.stdout, mimeType),
    mimeType,
    bytes: image.stdout.length,
    source: 'wayland',
  };
}

async function readXclipImage(): Promise<ClipboardImageData | null> {
  const targets = await runCommand('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']);
  if (targets.notFound || !targets.ok) return null;

  const mimeType = pickMimeType(parseMimeTypes(targets.stdout.toString('utf8')));
  if (!mimeType) return null;

  const image = await runCommand('xclip', ['-selection', 'clipboard', '-t', mimeType, '-o']);
  if (!image.ok) {
    throw new Error(image.stderr || 'Failed to read image from X11 clipboard.');
  }

  ensureImageBuffer(image.stdout);
  return {
    dataUrl: toDataUrl(image.stdout, mimeType),
    mimeType,
    bytes: image.stdout.length,
    source: 'x11',
  };
}

async function readMacImage(): Promise<ClipboardImageData | null> {
  const image = await runCommand('pngpaste', ['-']);
  if (image.notFound || !image.ok) return null;
  ensureImageBuffer(image.stdout);
  return {
    dataUrl: toDataUrl(image.stdout, 'image/png'),
    mimeType: 'image/png',
    bytes: image.stdout.length,
    source: 'macos',
  };
}

/**
 * Reads plain text from the system clipboard.
 * Uses pbpaste on macOS, wl-paste or xclip on Linux.
 *
 * @returns The clipboard text content.
 * @throws If clipboard access fails or is unsupported on the platform.
 */
export async function readClipboardText(): Promise<string> {
  const os = platform();
  if (os === 'darwin') {
    const result = await runCommand('pbpaste', []);
    if (!result.ok) throw new Error('Failed to read clipboard text.');
    return result.stdout.toString('utf8');
  }
  if (os === 'linux') {
    const wl = await runCommand('wl-paste', ['--no-newline']);
    if (wl.ok) return wl.stdout.toString('utf8');
    const xclip = await runCommand('xclip', ['-selection', 'clipboard', '-o']);
    if (xclip.ok) return xclip.stdout.toString('utf8');
    throw new Error('Failed to read clipboard text (`wl-paste` or `xclip` required).');
  }
  throw new Error(`Clipboard text paste is not supported on ${os}.`);
}

/**
 * Reads image data from the system clipboard and returns it as a data URL.
 * Tries platform-specific tools in order of preference.
 *
 * @returns The clipboard image as a {@link ClipboardImageData} object.
 * @throws If no image is found or clipboard tools are missing.
 */
export async function readClipboardImageData(): Promise<ClipboardImageData> {
  const os = platform();
  if (os === 'darwin') {
    const macImage = await readMacImage();
    if (macImage) return macImage;
    throw new Error('No image found in clipboard. Install `pngpaste` to enable Ctrl+V image paste on macOS.');
  }

  if (os === 'linux') {
    const waylandImage = await readWaylandImage();
    if (waylandImage) return waylandImage;

    const x11Image = await readXclipImage();
    if (x11Image) return x11Image;

    throw new Error('No image found in clipboard or clipboard tool missing (`wl-paste` or `xclip`).');
  }

  throw new Error(`Clipboard image paste is not supported on ${os}.`);
}
