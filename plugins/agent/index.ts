import { parseXMLAgentAction } from './parser';

export async function handleAgentActions(xml: string, context: any) {
  const actions = parseXMLAgentAction(xml);
  for (const action of actions) {
    if (action.type === 'spawn') {
      console.log(`[AGENT-SPAWN] ${new Date().toISOString()}: Spawning ${action.name}`);
      if (action.name.toLowerCase().includes('architect')) {
        console.log(`[SECURITY] ${new Date().toISOString()}: Blocked spawn of '${action.name}' (protected)`);
        continue;
      }
      const spawnXml = `&lt;xai:function_call name="agents_create"&gt;
&lt;parameter name="name"&gt;${action.name}&lt;/parameter&gt;
&lt;parameter name="responsibility"&gt;${action.responsibility}&lt;/parameter&gt;
${action.systemPrompt ? `&lt;parameter name="systemPrompt"&gt;${action.systemPrompt.replace(/&/g, '&amp;').replace(/&lt;/g, '&amp;lt;').replace(/&gt;/g, '&amp;gt;').replace(/&quot;/g, '&amp;quot;')}&lt;/parameter&gt;` : ''}
&lt;parameter name="autoPoll"&gt;${action.autoPoll}&lt;/parameter&gt;
&lt;/xai:function_call&gt;`;
      console.log(spawnXml);
    } else if (action.type === 'delete') {
      console.log(`[AGENT-DELETE] ${new Date().toISOString()}: Deleting ${action.agent}`);
      if (action.agent === 'agent-architect') {
        console.log('[SECURITY] Blocked deletion of Architect');
        continue;
      }
      const deleteXml = `&lt;xai:function_call name="agents_delete"&gt;
&lt;parameter name="agent"&gt;${action.agent.replace(/&/g, '&amp;').replace(/&lt;/g, '&amp;lt;').replace(/&gt;/g, '&amp;gt;').replace(/&quot;/g, '&amp;quot;')}&lt;/parameter&gt;
&lt;/xai:function_call&gt;`;
      console.log(deleteXml);
    } else if (action.type === 'end') {
      console.log(`[AGENT-END] ${new Date().toISOString()}: Task ${action.task_id} ${action.status}. Summary: ${action.summary || 'No summary'}`);
      const archSession = 'agent:agent-architect';
      const notifyXml = `&lt;xai:function_call name="sessions_send"&gt;
&lt;parameter name="sessionId"&gt;${archSession}&lt;/parameter&gt;
&lt;parameter name="message"&gt;## Agent-End Notification
**Task ID:** ${action.task_id}
**Status:** ${action.status}
**Summary:** ${action.summary || 'N/A'}&lt;/parameter&gt;
&lt;/xai:function_call&gt;`;
      console.log(notifyXml);
      const sayXml = `&lt;xai:function_call name="say_message"&gt;
&lt;parameter name="message"&gt;Agent-end processed: Task ${action.task_id} ${action.status}. Architect notified. (Architect handles todo update)&lt;/parameter&gt;
&lt;/xai:function_call&gt;`;
      console.log(sayXml);
    }
  }
}