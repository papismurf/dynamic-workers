# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-23

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **Project:** agent-orchestrator
- **Description:** AI Agent Orchestration Platform on Cloudflare Dynamic Workers
- **Agent domain expertise:** All agents (CodeGen, Test, Review) are configured for Python + Plotly Dash + Flask + FastAPI + ClickHouse. System prompts updated in both `src/agents/source.ts` (runtime embedded strings) and the individual reference `.ts` files.
- **Two places to update agent prompts:** `source.ts` contains the actual runtime embedded source (escaped backticks as `\\\``). The individual `codegen.ts`, `test.ts`, `review.ts` files are typed reference implementations — both must be kept in sync.
- **Test framework detection:** TestAgent checks for `requirements.txt` / `pyproject.toml` first (→ pytest), then falls back to `package.json` (→ vitest/jest/mocha). Default is now `pytest`.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
