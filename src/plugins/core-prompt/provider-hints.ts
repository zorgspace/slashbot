/**
 * Provider-specific prompt hints
 * Appended to system prompt to optimize behavior per model
 */

const hints: Record<string, string> = {
  xai: [
    '# Provider Notes (xAI)',
    'You are running on an xAI Grok model. XML action tags are your native output format.',
    'Use reasoning/thinking before complex operations.',
  ].join('\n'),
  anthropic: [
    '# Provider Notes (Anthropic)',
    'You are running on an Anthropic Claude model. XML output format works naturally for you.',
    'Prefer structured XML tags for all actions. Think step-by-step internally.',
  ].join('\n'),
  openai: [
    '# Provider Notes (OpenAI)',
    'You are running on an OpenAI model. Emit XML action tags exactly as documented.',
    'Ensure all XML tags are properly closed. Do not use markdown code blocks for actions.',
  ].join('\n'),
  google: [
    '# Provider Notes (Google)',
    'You are running on a Google Gemini model. Emit XML action tags exactly as documented.',
    'Ensure all XML tags are properly closed and well-formed.',
  ].join('\n'),
};

/**
 * Get provider-specific behavioral hints for the system prompt
 */
export function getProviderHints(provider: string): string {
  return hints[provider] || '';
}
