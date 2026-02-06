/**
 * Image Buffer Module
 * Centralized image handling for conversations
 */

import { MIME_TYPES, CONTEXT } from '../config/constants';

// Image storage - data URLs or file paths
export const imageBuffer: string[] = [];

/**
 * Add an image to the buffer (data URL or file path)
 */
export function addImage(imageData: string): void {
  imageBuffer.push(imageData);
}

/**
 * Get image by 1-based index
 */
export function getImage(n: number): string | undefined {
  return imageBuffer[n - 1];
}

/**
 * Get recent images for context (respects CONTEXT.MAX_IMAGES limit)
 */
export function getRecentImages(): string[] {
  return imageBuffer.slice(-CONTEXT.MAX_IMAGES);
}

/**
 * Clear all images from buffer
 */
export function clearImages(): void {
  imageBuffer.length = 0;
}

/**
 * Check if buffer has images
 */
export function hasImages(): boolean {
  return imageBuffer.length > 0;
}

/**
 * Get MIME type from file extension
 */
export function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
  return MIME_TYPES[ext] || 'image/png';
}

/**
 * Load image from file path and convert to data URL
 */
export async function loadImageFromFile(filePath: string): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');

  // Expand home directory
  let resolvedPath = filePath;
  if (resolvedPath.startsWith('~')) {
    resolvedPath = resolvedPath.replace('~', process.env.HOME || '');
  }

  // Make relative paths absolute
  if (!resolvedPath.startsWith('/')) {
    resolvedPath = path.join(process.cwd(), resolvedPath);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  const imageData = fs.readFileSync(resolvedPath);
  const mimeType = getMimeType(resolvedPath);
  const base64 = imageData.toString('base64');

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Load image from URL and convert to data URL
 */
export async function loadImageFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString('base64');

  // Try to determine MIME type from URL or content-type header
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const mimeType = contentType.split(';')[0].trim();

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Check if string is a valid image data URL
 */
export function isImageDataUrl(str: string): boolean {
  return /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/i.test(str);
}

/**
 * Get image size in KB from data URL
 */
export function getImageSizeKB(dataUrl: string): number {
  const base64Part = dataUrl.split(',')[1] || '';
  return Math.round(base64Part.length / 1024);
}
