export const PLUGIN_ID = 'slashbot.skills';
export type SkillSource = 'bundled' | 'global' | 'workspace';

export interface InvocationPolicy {
  userInvocable: boolean;
  disableModelInvocation: boolean;
}

export interface SkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

export interface InstallHint {
  kind: string;
  label?: string;
  formula?: string;
  package?: string;
  bins?: string[];
  os?: string[];
}

export interface SlashbotMetadata {
  emoji?: string;
  skillKey?: string;
  primaryEnv?: string;
  os?: string[];
  requires?: SkillRequirements;
  install?: InstallHint[];
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  homepage?: string;
  slashbot?: SlashbotMetadata;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
}

export interface SkillEntry {
  name: string;
  path: string;
  content: string;
  body: string;
  ruleFiles: string[];
  source: SkillSource;
  frontmatter: SkillFrontmatter;
  invocation: InvocationPolicy;
}

export interface PrerequisiteResult {
  ok: boolean;
  missingBins: string[];
  missingAnyBins: string[];
  missingEnv: string[];
  osMatch: boolean;
  hints: string[];
}

export interface SkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
}

export interface SkillsConfig {
  allowBundled: boolean;
  bundledAllowlist?: string[];
  entries: Record<string, SkillConfigEntry>;
}

export interface StatusReportEntry {
  name: string;
  source: SkillSource;
  eligible: boolean;
  disabled: boolean;
  reasons: string[];
}

export interface StatusReport {
  total: number;
  eligible: number;
  disabled: number;
  ineligible: number;
  entries: StatusReportEntry[];
}
