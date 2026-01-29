/**
 * Command Permissions Manager for Slashbot
 * Handles user approval for command execution
 */

import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { c } from '../ui/colors';

const CONFIG_DIR = path.join(process.cwd(), '.slashbot');
const PERMISSIONS_FILE = path.join(CONFIG_DIR, 'permissions.json');

export interface FolderPermissions {
  allowedCommands: string[];  // Commands always allowed in this folder
}

export interface PermissionsConfig {
  folders: Record<string, FolderPermissions>;
}

export type PromptResult = 'yes' | 'always' | 'no';

export class CommandPermissions {
  private config: PermissionsConfig = { folders: {} };
  private sessionDenied: Set<string> = new Set();  // Temporarily denied commands

  async load(): Promise<void> {
    try {
      const file = Bun.file(PERMISSIONS_FILE);
      if (await file.exists()) {
        this.config = await file.json();
      }
    } catch {
      this.config = { folders: {} };
    }
  }

  async save(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(PERMISSIONS_FILE, JSON.stringify(this.config, null, 2));
  }

  /**
   * Check if a command is allowed in the given folder
   */
  isAllowed(command: string, folder: string): boolean {
    const folderPerms = this.config.folders[folder];
    if (!folderPerms) return false;

    // Check exact match
    if (folderPerms.allowedCommands.includes(command)) {
      return true;
    }

    // Check command prefix match (e.g., "npm" allows "npm install", "npm test", etc.)
    const cmdBase = command.split(' ')[0];
    return folderPerms.allowedCommands.some(allowed => {
      // If allowed is a base command (no spaces), match any command starting with it
      if (!allowed.includes(' ') && cmdBase === allowed) {
        return true;
      }
      return false;
    });
  }

  /**
   * Add permanent permission for a command in a folder
   */
  async addPermission(command: string, folder: string): Promise<void> {
    if (!this.config.folders[folder]) {
      this.config.folders[folder] = { allowedCommands: [] };
    }

    // Store the base command for broader matching
    const cmdBase = command.split(' ')[0];

    if (!this.config.folders[folder].allowedCommands.includes(cmdBase)) {
      this.config.folders[folder].allowedCommands.push(cmdBase);
      await this.save();
    }
  }

  /**
   * Get the key for session denial tracking
   */
  private getDenialKey(command: string, folder: string): string {
    return `${folder}::${command}`;
  }

  /**
   * Check if command was denied this session
   */
  isDeniedThisSession(command: string, folder: string): boolean {
    return this.sessionDenied.has(this.getDenialKey(command, folder));
  }

  /**
   * Mark command as denied for this session
   */
  denyForSession(command: string, folder: string): void {
    this.sessionDenied.add(this.getDenialKey(command, folder));
  }

  /**
   * Prompt user for command approval with interactive selector
   */
  async promptForApproval(command: string, folder: string): Promise<PromptResult> {
    return new Promise((resolve) => {
      const folderName = path.basename(folder);
      const cmdBase = command.split(' ')[0];

      const options: { label: string; value: PromptResult; color: (s: string) => string }[] = [
        { label: 'Allow once', value: 'yes', color: c.success },
        { label: `Always allow '${cmdBase}' in ${folderName}`, value: 'always', color: c.success },
        { label: 'Deny', value: 'no', color: c.error },
      ];

      let selectedIndex = 0;

      const renderMenu = () => {
        // Clear previous render (move up and clear lines)
        process.stdout.write(`\x1b[${options.length + 1}A`); // Move up
        process.stdout.write('\x1b[J'); // Clear from cursor to end

        options.forEach((opt, i) => {
          const prefix = i === selectedIndex ? c.violet('› ') : '  ';
          const text = i === selectedIndex ? c.white(opt.label) : c.muted(opt.label);
          console.log(`${prefix}${text}`);
        });
        console.log(c.muted('  ↑↓ select · Enter confirm'));
      };

      // Initial render
      console.log();
      console.log(c.warning('Command execution requested:'));
      console.log(c.violet(`  $ ${command}`));
      console.log(c.muted(`  in ${folder}`));
      console.log();

      // Print initial menu
      options.forEach((opt, i) => {
        const prefix = i === selectedIndex ? c.violet('› ') : '  ';
        const text = i === selectedIndex ? c.white(opt.label) : c.muted(opt.label);
        console.log(`${prefix}${text}`);
      });
      console.log(c.muted('  ↑↓ select · Enter confirm'));

      // Enable raw mode for keyboard input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onKeyPress = (key: Buffer) => {
        const keyStr = key.toString();

        // Arrow up
        if (keyStr === '\x1b[A' || keyStr === 'k') {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          renderMenu();
        }
        // Arrow down
        else if (keyStr === '\x1b[B' || keyStr === 'j') {
          selectedIndex = (selectedIndex + 1) % options.length;
          renderMenu();
        }
        // Enter
        else if (keyStr === '\r' || keyStr === '\n') {
          cleanup();
          resolve(options[selectedIndex].value);
        }
        // Escape or q or n = deny
        else if (keyStr === '\x1b' || keyStr === 'q' || keyStr === 'n') {
          cleanup();
          resolve('no');
        }
        // y = allow once
        else if (keyStr === 'y') {
          cleanup();
          resolve('yes');
        }
        // Y = always
        else if (keyStr === 'Y') {
          cleanup();
          resolve('always');
        }
        // Ctrl+C
        else if (keyStr === '\x03') {
          cleanup();
          resolve('no');
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', onKeyPress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        console.log();
      };

      process.stdin.on('data', onKeyPress);
    });
  }

  /**
   * List allowed commands for a folder
   */
  getAllowedCommands(folder: string): string[] {
    return this.config.folders[folder]?.allowedCommands || [];
  }

  /**
   * Remove a permission
   */
  async removePermission(command: string, folder: string): Promise<boolean> {
    const folderPerms = this.config.folders[folder];
    if (!folderPerms) return false;

    const idx = folderPerms.allowedCommands.indexOf(command);
    if (idx >= 0) {
      folderPerms.allowedCommands.splice(idx, 1);
      await this.save();
      return true;
    }
    return false;
  }

  /**
   * Clear all permissions for a folder
   */
  async clearPermissions(folder: string): Promise<void> {
    delete this.config.folders[folder];
    await this.save();
  }
}

export function createCommandPermissions(): CommandPermissions {
  return new CommandPermissions();
}
