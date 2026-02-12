# Memory Notes

- [2026-02-12T18:56:14.292Z] AGENT WORKFLOW POLICY (2026-02-12): Specialist subagents MUST fully verify all changes (run lint, build, tests; fix all issues) before end_task. NEVER delegate code implementation, file edits, bash/git ops back to Architect (orchestration-only lane, blocks impl tools). Complete autonomously or end_task with user clarification request. Orchestrators delegate with explicit instructions including this policy. [tags: agent-policy, verification, delegation, architect]
