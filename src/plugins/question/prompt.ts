export const QUESTION_PROMPT = [
  'Use `<question>` to ask the user structured multi-choice questions when you need clarification.',
  '',
  'Format:',
  '<question>',
  '  <text>Which approach should we use?</text>',
  '  <option>Option A</option>',
  '  <option description="More detail about B">Option B</option>',
  '  <option>Option C</option>',
  '</question>',
  '',
  'Only ask questions when truly blocked. For simple confirmations, use `<end>` with your question.',
  'Prefer `<question>` when there are 2+ distinct approaches and user preference matters.',
].join('\n');
