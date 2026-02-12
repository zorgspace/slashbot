export interface AgentSpawnAction {
  type: 'spawn';
  name: string;
  responsibility: string;
  systemPrompt?: string;
  autoPoll?: boolean;
}

export interface AgentDeleteAction {
  type: 'delete';
  agent: string;
}

export interface AgentEndAction {
  type: 'end';
  task_id: string;
  status: string;
  summary?: string;
}

export function parseXMLAgentAction(xml: string): (AgentSpawnAction | AgentDeleteAction | AgentEndAction)[] {
  const actions: (AgentSpawnAction | AgentDeleteAction | AgentEndAction)[] = [];
  const spawnRegex = /<agent-spawn\s+name="([^"]+)"\s+responsibility="([^"]+)"(?:\s+systemPrompt="([^"]*)")?(?:\s+autoPoll="([^"]*)")?\s*\/>/gi;
  const deleteRegex = /<agent-delete\s+agent="([^"]+)"\s*\/>/gi;
  const endRegex = /<agent-end\s+task_id="([^"]+)"\s+status="([^"]+)"(?:\s+summary="([^"]*)")?\s*\/>/gi;

  let match;
  while ((match = spawnRegex.exec(xml)) !== null) {
    actions.push({
      type: 'spawn',
      name: match[1],
      responsibility: match[2],
      systemPrompt: match[3] || undefined,
      autoPoll: match[4] !== 'false'
    });
  }
  while ((match = deleteRegex.exec(xml)) !== null) {
    actions.push({
      type: 'delete',
      agent: match[1]
    });
  }
  while ((match = endRegex.exec(xml)) !== null) {
    actions.push({
      type: 'end',
      task_id: match[1],
      status: match[2],
      summary: match[3] || undefined
    });
  }
  return actions;
}