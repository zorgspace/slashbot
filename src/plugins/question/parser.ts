import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getQuestionParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['question'],
      preStrip: true,
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<question\s*>([\s\S]*?)<\/question>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const inner = match[1];

          // Parse question text
          const questionTextMatch = inner.match(/<text>([\s\S]*?)<\/text>/i);
          const questionText = questionTextMatch
            ? questionTextMatch[1].trim()
            : inner.split('<option')[0].trim();

          // Parse options
          const optionRegex =
            /<option\s*(?:description=["']([^"']*)["'])?\s*>([\s\S]*?)<\/option>/gi;
          const options: { label: string; description?: string }[] = [];
          let optMatch;
          while ((optMatch = optionRegex.exec(inner)) !== null) {
            options.push({
              label: optMatch[2].trim(),
              description: optMatch[1] || undefined,
            });
          }

          // Check for multiSelect attribute
          const multiSelect =
            /multiSelect=["']true["']/i.test(match[0]) || /multi-select/i.test(match[0]);

          if (questionText && options.length >= 2) {
            actions.push({
              type: 'question',
              questions: [
                {
                  question: questionText,
                  options,
                  multiSelect,
                },
              ],
            } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
