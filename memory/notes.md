# Memory Notes

- [2026-02-12T18:56:14.292Z] AGENT WORKFLOW POLICY (2026-02-12): Specialist subagents MUST fully verify all changes (run lint, build, tests; fix all issues) before end_task. NEVER delegate code implementation, file edits, bash/git ops back to Architect (orchestration-only lane, blocks impl tools). Complete autonomously or end_task with user clarification request. Orchestrators delegate with explicit instructions including this policy. [tags: agent-policy, verification, delegation, architect]
- [2026-02-13T03:19:08.775Z] Delegated prompt enforcement task (add build/test verification) to agent-developer on 2026-02-13. Monitor for completion report. [tags: agents, prompts, verification]
- [2026-02-13T03:21:55.806Z] Continued kernel.ts dev for agent task event handling (display subagent msgs in architect, auto-review tasks). Delegated to agent-developer for wiring/verification/commit. [tags: kernel, agents, orchestrator, dev]
- [2026-02-13T03:25:43.069Z] Skills fallback impl: ~/.agents/skills first, then .slashbot/skills. Delegated to developer 2026-02-13. [tags: skills, fallback, dirs]
