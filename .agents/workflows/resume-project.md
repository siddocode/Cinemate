---
description: Resume work on Syncora from existing documentation and codebase state
---

# Workflow: Resume Project

Follow this workflow whenever a new conversation session starts or when resuming work on Syncora.

## Steps

1. **Read Core Context Files First**
   - Read `CURRENT_STATE.md` to identify:
     - Current phase
     - Active task
     - Pending tasks
     - Known blockers
   - Read `AGENTS.md` to recall coding rules and architectural constraints.
   - Read `DECISIONS.md` to respect agreed architecture and technology decisions.

2. **Inspect Codebase State**
   - Check git status (`git status`, `git branch`, recent commits) to understand the local tree.
   - Inspect only the files directly relevant to the current active task (do not read the entire codebase into context).

3. **Verify Active Task**
   - Check if the task stated in `CURRENT_STATE.md` was completed or interrupted.
   - If tests or verification are missing, verify the previous step before advancing.

4. **Execute Current Task**
   - Work on ONE sub-task at a time within the current approved phase.
   - Follow the testing and validation standards outlined in `AGENTS.md`.

5. **Update State**
   - Update `CURRENT_STATE.md` and `TASKS.md` upon completing work.

