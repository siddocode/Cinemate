---
description: Verify deliverables, run tests, and document completion before ending a phase
---

# Workflow: Finish Phase

Follow this workflow before declaring any development phase complete.

## Steps

1. **Review Phase Deliverables**
   - Check all requirements for the phase in `PROJECT.md` and `TASKS.md`.
   - Ensure no requirements were skipped, mocked, or left half-finished.

2. **Run Verification and Quality Checks**
   - Execute TypeScript compilation checks (`npm run type-check` or `npx tsc --noEmit`).
   - Run linter (`npm run lint`).
   - Run tests if applicable.
   - Test manually across simulated network latency or multi-tab scenarios where relevant.

3. **Inspect Implementation Quality**
   - Verify proper error handling and boundary safety.
   - Verify client vs server separation (no leaked service-role keys, inputs validated on server).
   - Verify UI responsiveness across breakpoints.

4. **Update Project Documentation**
   - Update `CURRENT_STATE.md` with:
     - Completed phase and items
     - Active next phase
     - Any blockers or known limitations
   - Update `TASKS.md` marking completed tasks `[x]`.
   - If new technical decisions were made, record them in `DECISIONS.md`.

5. **Prepare Phase Completion Summary & Handoff**
   - Present to the user:
     1. What was completed.
     2. Important technical decisions made.
     3. Files created or modified.
     4. Tests performed and results.
     5. Remaining work, risks, and next phase preview.
   - If the next phase requires external credentials, clearly state the required accounts, variables, and links.
   - Wait for explicit user approval before proceeding to the next phase.

