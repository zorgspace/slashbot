/**
 * Image Buffer Module
 * Stores image paths or base64 for reference in conversations
 */

export const imageBuffer: string[] = []; // image paths or base64 data

export function addImage(filePath: string): void {
  imageBuffer.push(filePath);
}

export function getImage(n: number): string | undefined {
  return imageBuffer[n - 1];
}