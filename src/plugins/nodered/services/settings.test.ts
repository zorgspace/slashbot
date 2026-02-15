import { describe, it, expect, beforeEach } from 'vitest';
import { generateSettings } from './settings';
import type { NodeRedConfig } from '../types';

describe('generateSettings', () => {
  let defaultConfig: NodeRedConfig;

  beforeEach(() => {
    defaultConfig = {
      enabled: true,
      port: 1880,
      userDir: '~/.slashbot/nodered',
      healthCheckInterval: 30,
      shutdownTimeout: 10,
      maxRestartAttempts: 3,
      localhostOnly: true,
    };
  });

  describe('output format', () => {
    it('produces valid JavaScript string', () => {
      const result = generateSettings(defaultConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('starts with module.exports declaration', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/^module\.exports\s*=/);
    });

    it('can be evaluated as valid JavaScript', () => {
      const result = generateSettings(defaultConfig);
      expect(() => {
        // Use Function constructor to validate syntax without executing
        new Function(`return ${result.replace(/^module\.exports\s*=\s*/, '')}`);
      }).not.toThrow();
    });

    it('generates proper JavaScript object literal', () => {
      const result = generateSettings(defaultConfig);
      // Should contain object structure
      expect(result).toContain('{');
      expect(result).toContain('}');
      expect(result).toContain(':');
    });
  });

  describe('uiPort mapping', () => {
    it('sets uiPort to match config.port', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('uiPort: 1880');
    });

    it('applies custom port value correctly', () => {
      const customConfig = { ...defaultConfig, port: 3000 };
      const result = generateSettings(customConfig);
      expect(result).toContain('uiPort: 3000');
    });

    it('handles different port values', () => {
      const ports = [80, 8080, 1234, 9999];
      ports.forEach(port => {
        const config = { ...defaultConfig, port };
        const result = generateSettings(config);
        expect(result).toContain(`uiPort: ${port}`);
      });
    });
  });

  describe('userDir mapping', () => {
    it('sets userDir to match config.userDir', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('userDir: ');
      expect(result).toContain('~/.slashbot/nodered');
    });

    it('applies custom userDir correctly', () => {
      const customConfig = { ...defaultConfig, userDir: '/custom/path/nodered' };
      const result = generateSettings(customConfig);
      expect(result).toContain('/custom/path/nodered');
    });

    it('properly quotes userDir path', () => {
      const result = generateSettings(defaultConfig);
      // Should be quoted as a string
      expect(result).toMatch(/userDir:\s*['"].*?['"]/);
    });
  });

  describe('flowFile mapping', () => {
    it('defaults flowFile to flows.json', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('flowFile: ');
      expect(result).toContain('flows.json');
    });

    it('properly quotes flowFile', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/flowFile:\s*['"]flows\.json['"]/);
    });
  });

  describe('httpAdminRoot mapping', () => {
    it('sets httpAdminRoot to /', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('httpAdminRoot: ');
      expect(result).toMatch(/httpAdminRoot:\s*['"]\/['"]/);
    });
  });

  describe('httpNodeRoot mapping', () => {
    it('sets httpNodeRoot to /', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('httpNodeRoot: ');
      expect(result).toMatch(/httpNodeRoot:\s*['"]\/['"]/);
    });
  });

  describe('functionGlobalContext mapping', () => {
    it('defines functionGlobalContext', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('functionGlobalContext');
    });

    it('sets functionGlobalContext to empty object', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/functionGlobalContext:\s*\{\s*\}/);
    });
  });

  describe('logging configuration', () => {
    it('defines logging section', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('logging');
    });

    it('defines logging.console section', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/logging:\s*\{[\s\S]*console:/);
    });

    it('sets console.level to appropriate level', () => {
      const result = generateSettings(defaultConfig);
      // Should have a logging level (info, debug, warn, etc.)
      expect(result).toMatch(/level:\s*['"](?:info|debug|warn|error)['"]/);
    });

    it('uses info level by default', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain("level: 'info'");
    });
  });

  describe('editorTheme configuration', () => {
    it('defines editorTheme section', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toContain('editorTheme');
    });

    it('configures editorTheme as object', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/editorTheme:\s*\{/);
    });

    it('includes projects configuration', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/editorTheme:\s*\{[\s\S]*projects:/);
    });

    it('sets projects.enabled to false by default', () => {
      const result = generateSettings(defaultConfig);
      expect(result).toMatch(/projects:\s*\{[\s\S]*enabled:\s*false/);
    });
  });

  describe('uiHost configuration', () => {
    it('sets uiHost to localhost when localhostOnly is true', () => {
      const config = { ...defaultConfig, localhostOnly: true };
      const result = generateSettings(config);
      expect(result).toMatch(/uiHost:\s*['"](?:localhost|127\.0\.0\.1)['"]/);
    });

    it('sets uiHost to 0.0.0.0 when localhostOnly is false', () => {
      const config = { ...defaultConfig, localhostOnly: false };
      const result = generateSettings(config);
      expect(result).toMatch(/uiHost:\s*['"]0\.0\.0\.0['"]/);
    });

    it('respects localhostOnly config flag', () => {
      const localhostConfig = { ...defaultConfig, localhostOnly: true };
      const publicConfig = { ...defaultConfig, localhostOnly: false };

      const localhostResult = generateSettings(localhostConfig);
      const publicResult = generateSettings(publicConfig);

      expect(localhostResult).not.toBe(publicResult);
    });
  });

  describe('required fields presence', () => {
    it('includes all required settings.js fields', () => {
      const result = generateSettings(defaultConfig);
      const requiredFields = [
        'uiPort',
        'userDir',
        'flowFile',
        'httpAdminRoot',
        'httpNodeRoot',
        'functionGlobalContext',
        'logging',
        'editorTheme',
      ];

      requiredFields.forEach(field => {
        expect(result).toContain(field);
      });
    });
  });

  describe('config-to-JS mapping completeness', () => {
    it('maps all relevant config fields to settings.js', () => {
      const config: NodeRedConfig = {
        enabled: true,
        port: 2000,
        userDir: '/test/dir',
        healthCheckInterval: 60,
        shutdownTimeout: 20,
        maxRestartAttempts: 5,
        localhostOnly: false,
      };

      const result = generateSettings(config);

      // Port mapping
      expect(result).toContain('uiPort: 2000');

      // UserDir mapping
      expect(result).toContain('/test/dir');

      // LocalhostOnly mapping (affects uiHost)
      expect(result).toMatch(/uiHost:\s*['"]0\.0\.0\.0['"]/);
    });
  });

  describe('edge cases', () => {
    it('handles minimal config object', () => {
      const minimalConfig = { ...defaultConfig };
      expect(() => generateSettings(minimalConfig)).not.toThrow();
    });

    it('handles config with all fields specified', () => {
      const fullConfig: NodeRedConfig = {
        enabled: false,
        port: 9999,
        userDir: '/full/path/test',
        healthCheckInterval: 120,
        shutdownTimeout: 30,
        maxRestartAttempts: 10,
        localhostOnly: true,
      };
      expect(() => generateSettings(fullConfig)).not.toThrow();
    });

    it('produces consistent output for same config', () => {
      const result1 = generateSettings(defaultConfig);
      const result2 = generateSettings(defaultConfig);
      expect(result1).toBe(result2);
    });
  });

  describe('JavaScript syntax validation', () => {
    it('uses proper comma separation between fields', () => {
      const result = generateSettings(defaultConfig);
      // Count commas (should have one between each field)
      const commaCount = (result.match(/,/g) || []).length;
      expect(commaCount).toBeGreaterThan(5); // At least 6 fields
    });

    it('does not have trailing comma in object', () => {
      const result = generateSettings(defaultConfig);
      // Should not end with ", }"
      expect(result).not.toMatch(/,\s*\}\s*;?\s*$/);
    });

    it('properly closes all braces', () => {
      const result = generateSettings(defaultConfig);
      const openBraces = (result.match(/\{/g) || []).length;
      const closeBraces = (result.match(/\}/g) || []).length;
      expect(openBraces).toBe(closeBraces);
    });
  });

  describe('special characters in paths', () => {
    it('handles paths with spaces', () => {
      const config = { ...defaultConfig, userDir: '/path with spaces/nodered' };
      const result = generateSettings(config);
      expect(result).toContain('/path with spaces/nodered');
    });

    it('handles paths with tilde expansion', () => {
      const config = { ...defaultConfig, userDir: '~/my-nodered' };
      const result = generateSettings(config);
      expect(result).toContain('~/my-nodered');
    });

    it('handles absolute paths', () => {
      const config = { ...defaultConfig, userDir: '/var/lib/nodered' };
      const result = generateSettings(config);
      expect(result).toContain('/var/lib/nodered');
    });

    it('escapes single quotes in userDir (T030)', () => {
      const config = { ...defaultConfig, userDir: "/path/it's/nodered" };
      const result = generateSettings(config);
      // The single quote should be escaped so the generated JS is valid
      expect(result).toContain("\\'");
      // The generated JS should be syntactically valid
      expect(() => {
        new Function(`return ${result.replace(/^module\.exports\s*=\s*/, '')}`);
      }).not.toThrow();
    });
  });

  describe('port ranges', () => {
    it('handles low port numbers', () => {
      const config = { ...defaultConfig, port: 80 };
      const result = generateSettings(config);
      expect(result).toContain('uiPort: 80');
    });

    it('handles high port numbers', () => {
      const config = { ...defaultConfig, port: 65535 };
      const result = generateSettings(config);
      expect(result).toContain('uiPort: 65535');
    });

    it('handles typical Node-RED port', () => {
      const config = { ...defaultConfig, port: 1880 };
      const result = generateSettings(config);
      expect(result).toContain('uiPort: 1880');
    });
  });

  describe('logging levels', () => {
    it('includes valid logging configuration', () => {
      const result = generateSettings(defaultConfig);
      // The logging object should be well-formed
      expect(result).toMatch(/logging:\s*\{[\s\S]*console:\s*\{[\s\S]*level:/);
    });
  });

  describe('integration readiness', () => {
    it('generates settings.js that Node-RED would accept', () => {
      const result = generateSettings(defaultConfig);

      // Check for Node-RED expected structure
      expect(result).toContain('module.exports');
      expect(result).toContain('uiPort');
      expect(result).toContain('userDir');
      expect(result).toContain('flowFile');
      expect(result).toContain('httpAdminRoot');
      expect(result).toContain('httpNodeRoot');
    });

    it('does not include undefined or null values', () => {
      const result = generateSettings(defaultConfig);
      expect(result).not.toContain('undefined');
      expect(result).not.toContain('null');
    });
  });
});
