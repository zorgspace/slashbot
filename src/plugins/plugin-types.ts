/**
 * Plugin contribution types used by core (prompt assembler, etc.)
 * Full plugin contract lives in plugins/types.ts.
 */

export interface PromptContribution {
  id: string;
  title: string;
  priority: number;
  content?: string | Function | readonly string[];
  enabled?: boolean | Function;
}

export interface ContextProvider {
  id?: string;
  label?: string;
  priority?: number;
  isActive?: () => boolean;
  getContext: () => Promise<string | null>;
}
