---
description: Plan, inspect, and implement a new feature safely without breaking architecture
---

# Workflow: Add Feature

Follow this workflow whenever a new feature is requested outside or within the established phases.

## Steps

1. **Understand Feature Scope**
   - Read the user's feature request thoroughly.
   - Clarify any ambiguities before making assumptions.

2. **Inspect Existing Architecture and Code**
   - Check `ARCHITECTURE.md` and relevant code files.
   - Identify which layers are affected:
     - Database schema & RLS
     - Supabase Realtime channels
     - Core sync engine & player adapters
     - Next.js server actions / API routes
     - UI components & hooks

3. **Formulate Architectural Proposal**
   - Assess compatibility with host-authoritative model.
   - Assess performance and network overhead.
   - Explain proposed changes to the user and update `DECISIONS.md` if significant.

4. **Implementation**
   - Write clean, modular TypeScript code following standards in `AGENTS.md`.
   - Keep business logic in adapters/hooks/services, separate from UI components.
   - Never bypass validation or leak secrets.

5. **Test & Document**
   - Verify feature across multiple browser sessions if realtime/playback related.
   - Update `CURRENT_STATE.md`, `PROJECT.md`, and `TASKS.md`.

