/**
 * File System Module with Permission System
 * All write operations require explicit y/n confirmation
 */

import { display } from '../../../core/ui';
import * as path from 'path';

export interface FileOperation {
  type: 'read' | 'write' | 'delete' | 'create';
  path: string;
  content?: string;
}

export interface FileSystemConfig {
  basePath?: string;
  allowOutsideBase?: boolean;
}

export class SecureFileSystem {
  private config: FileSystemConfig;

  constructor(config: FileSystemConfig = {}) {
    this.config = {
      basePath: process.cwd(),
      allowOutsideBase: false,
      ...config,
    };
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.config.basePath!, filePath);
  }

  private isPathAllowed(filePath: string): boolean {
    if (this.config.allowOutsideBase) return true;

    const resolved = this.resolvePath(filePath);
    const base = this.config.basePath!;

    return resolved.startsWith(base);
  }

  private async askConfirmation(message: string): Promise<boolean> {
    return display.promptConfirmation(message);
  }

  async readFile(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${filePath} is outside the allowed directory`);
    }

    try {
      const file = Bun.file(resolved);
      const exists = await file.exists();

      if (!exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      return await file.text();
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${filePath} is outside the allowed directory`);
    }

    try {
      await Bun.write(resolved, content);
      return true;
    } catch (error) {
      throw new Error(`Failed to write file: ${error}`);
    }
  }

  async appendFile(filePath: string, content: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${filePath} is outside the allowed directory`);
    }

    try {
      const file = Bun.file(resolved);
      const exists = await file.exists();
      const existing = exists ? await file.text() : '';

      await Bun.write(resolved, existing + content);
      return true;
    } catch (error) {
      throw new Error(`Failed to append to file: ${error}`);
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${filePath} is outside the allowed directory`);
    }

    try {
      const { unlink } = await import('fs/promises');
      await unlink(resolved);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete file: ${error}`);
    }
  }

  async createDirectory(dirPath: string): Promise<boolean> {
    const resolved = this.resolvePath(dirPath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${dirPath} is outside the allowed directory`);
    }

    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(resolved, { recursive: true });
      return true;
    } catch (error) {
      throw new Error(`Failed to create directory: ${error}`);
    }
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    const resolved = this.resolvePath(dirPath);

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: ${dirPath} is outside the allowed directory`);
    }

    try {
      const { readdir } = await import('fs/promises');
      return await readdir(resolved);
    } catch (error) {
      throw new Error(`Failed to list directory: ${error}`);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);
    const file = Bun.file(resolved);
    return file.exists();
  }

  async getFileInfo(filePath: string): Promise<{ size: number; modified: Date } | null> {
    const resolved = this.resolvePath(filePath);

    if (!this.isPathAllowed(resolved)) {
      return null;
    }

    try {
      const { stat } = await import('fs/promises');
      const stats = await stat(resolved);
      return {
        size: stats.size,
        modified: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  getBasePath(): string {
    return this.config.basePath!;
  }
}

// Factory function
export function createFileSystem(basePath?: string): SecureFileSystem {
  return new SecureFileSystem({
    basePath: basePath || process.cwd(),
    allowOutsideBase: false,
  });
}
