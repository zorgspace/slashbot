import type { AgentProfile, AgentTask } from '../../plugins/agents/services';

export const MISSING_END_TASK_ERROR =
  'Task did not finish with an <end_task> action. Finish the work and submit the final report before completing the task.';

export function buildDelegatedTaskPrompt(options: {
  agent: AgentProfile;
  task: Pick<AgentTask, 'id' | 'title' | 'content' | 'fromAgentId'>;
  isOrchestrator: boolean;
}): string {
  const { agent, task, isOrchestrator } = options;
  if (isOrchestrator) {
    return [
      `You are processing delegated coordination task ${task.id}.`,
      `Agent: ${agent.id} (${agent.name})`,
      `Responsibility: ${agent.responsibility}`,
      `Title: ${task.title}`,
      `From: ${task.fromAgentId}`,
      'Task details:',
      task.content,
      '',
      'Execution policy:',
      '- This is an orchestrator lane. Never implement directly.',
      '- Plan, triage, delegate, and verify only.',
      '- If implementation is required, delegate to a specialist with <agent-send>.',
      '- Use agents_status/agents_tasks/agents_verify/agents_recall/sessions_* for coordination; avoid loops.',
      '- Use say_message for concise progress updates.',
      '- Close only after worker evidence is sufficient and follow-up tasks are settled.',
      'When complete, summarize in 3-6 bullets: delegation decisions, worker evidence, validation status, and remaining risks.',
    ].join('\n');
  }

  return [
    `You are executing delegated task ${task.id}.`,
    `Agent: ${agent.id} (${agent.name})`,
    `Responsibility: ${agent.responsibility}`,
    `Title: ${task.title}`,
    `From: ${task.fromAgentId}`,
    'Task details:',
    task.content,
    '',
    'Execution policy:',
    '- Start immediately with concrete execution (read/edit/write/bash/test).',
    '- Use agents_send only when blocked by missing ownership/context.',
    '- Do not loop on coordination tools.',
    '- For bug/incident tasks: reproduce -> fix -> verify. Do not skip verification.',
    '- If build/test/lint/typecheck fails, continue working and rerun verification until passing before end_task.',
    '- Include real evidence in final output: files changed + command(s)/test(s) run + result.',
    '- If task is clearly outside your specialization, delegate once to the best specialist with a precise request, then stop.',
    `- Before <end_task>, send completion report to ${task.fromAgentId} via <agent-send>.`,
    '- Use say_message for concise progress updates.',
    'When complete, summarize in 3-6 bullets: root cause, fix, validation, remaining risks.',
  ].join('\n');
}

export function summarizeDelegatedTaskResult(
  result: { response: string; endMessage?: string },
  maxChars = 2000,
): string {
  if (!result.endMessage) {
    throw new Error(MISSING_END_TASK_ERROR);
  }
  return (result.endMessage || result.response).slice(0, maxChars);
}
