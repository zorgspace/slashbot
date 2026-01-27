import fs from 'fs';
import path from 'path';

export const imageBuffer: string[] = []; // paths ou base64

export function addImage(filePath: string) {
  imageBuffer.push(filePath);
}

export function getImage(n: number): string | undefined {
  return imageBuffer[n - 1];
}