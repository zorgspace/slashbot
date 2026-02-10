import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { QuestionAction } from './types';
import { display } from '../../core/ui';

export async function executeQuestion(
  action: QuestionAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const results: string[] = [];

  for (const q of action.questions) {
    display.append('');
    display.violet(q.question);
    display.append('');

    // Display options with numbers
    q.options.forEach((opt, i) => {
      const desc = opt.description ? ` - ${opt.description}` : '';
      display.append(`  ${i + 1}. ${opt.label}${desc}`);
    });
    display.append('');

    // For TUI mode, we use a simple numbered selection via display
    // The user types a number and it's captured as the next input
    // For now, present the question and let the user respond naturally
    const optionList = q.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n');
    results.push(`Question: ${q.question}\nOptions:\n${optionList}\n\nAwaiting user response...`);
  }

  return {
    action: 'Question',
    success: true,
    result: results.join('\n\n'),
  };
}
