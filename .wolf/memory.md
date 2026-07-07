# Memory

> Chronological action log. Hooks and AI append to this file automatically.
> Old sessions are consolidated by the daemon weekly.

## Session: 2026-04-25 13:50

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 20:22 | Created examples/task-ui/package.json | — | ~218 |
| 20:22 | Created examples/task-ui/vite.config.ts | — | ~172 |
| 20:22 | Created examples/task-ui/tsconfig.json | — | ~129 |
| 20:22 | Created examples/task-ui/index.html | — | ~131 |
| 20:23 | Created examples/task-ui/README.md | — | ~782 |
| 20:23 | Created examples/task-ui/src/index.css | — | ~71 |
| 20:23 | Created examples/task-ui/src/main.tsx | — | ~85 |
| 20:23 | Created examples/task-ui/src/App.tsx | — | ~370 |
| 20:23 | Created examples/task-ui/src/api/types.ts | — | ~735 |
| 20:23 | Created examples/task-ui/src/api/client.ts | — | ~480 |
| 20:23 | Created examples/task-ui/src/hooks/useTask.ts | — | ~204 |
| 20:23 | Created examples/task-ui/src/hooks/useTaskStream.ts | — | ~704 |
| 20:23 | Created examples/task-ui/src/hooks/useUsage.ts | — | ~161 |
| 20:24 | Created examples/task-ui/src/components/TaskCard.tsx | — | ~2006 |
| 20:24 | Created examples/task-ui/src/components/LogStream.tsx | — | ~1187 |
| 20:24 | Created examples/task-ui/src/components/UsageSidebar.tsx | — | ~1122 |
| 20:25 | Created examples/task-ui/src/components/ReviewPanel.tsx | — | ~2447 |
| 20:25 | Created examples/task-ui/src/components/TaskForm.tsx | — | ~4520 |
| 20:26 | Created examples/task-ui/src/pages/HomePage.tsx | — | ~1542 |
| 20:26 | Created examples/task-ui/src/pages/TaskPage.tsx | — | ~2387 |
| 20:26 | Built full examples/task-ui/ — Vite+React19+TS task submission & monitoring UI | examples/task-ui/** | 21 files created | ~18k |
| 20:27 | Session end: 20 writes across 20 files (package.json, vite.config.ts, tsconfig.json, index.html, README.md) | 3 reads | ~29767 tok |
| 22:32 | Session end: 20 writes across 20 files (package.json, vite.config.ts, tsconfig.json, index.html, README.md) | 3 reads | ~29767 tok |
| 22:33 | Session end: 20 writes across 20 files (package.json, vite.config.ts, tsconfig.json, index.html, README.md) | 3 reads | ~29767 tok |
| 09:32 | Edited src/index.ts | added 1 condition(s) | ~865 |
| 09:32 | Session end: 21 writes across 21 files (package.json, vite.config.ts, tsconfig.json, index.html, README.md) | 3 reads | ~30632 tok |
| 11:26 | Created ../../../../../../../../home/brown/.claude/plans/shiny-knitting-stream.md | — | ~693 |
| 20:02 | Session end: 22 writes across 22 files (package.json, vite.config.ts, tsconfig.json, index.html, README.md) | 8 reads | ~32821 tok |

## Session: 2026-04-26 20:02

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 20:03 | Created examples/task-ui/Dockerfile | — | ~45 |
| 20:03 | Created examples/task-ui/.dockerignore | — | ~7 |
| 20:03 | Edited examples/task-ui/vite.config.ts | 2→3 lines | ~13 |
| 20:03 | Edited docker-compose.dev.yml | expanded (+12 lines) | ~94 |
| 20:09 | Implemented Docker setup for task-ui + fixed stale node_modules volume | examples/task-ui/Dockerfile, examples/task-ui/.dockerignore, examples/task-ui/vite.config.ts, docker-compose.dev.yml | created Dockerfile/.dockerignore, added host:true to Vite, added task-ui service to compose | ~200 |
| 20:10 | Session end: 4 writes across 4 files (Dockerfile, .dockerignore, vite.config.ts, docker-compose.dev.yml) | 2 reads | ~713 tok |
| 08:52 | Edited docker-compose.dev.yml | 21→19 lines | ~219 |
| 08:54 | Fixed workerd ENOENT — removed named volume node_modules mount from docker-compose.dev.yml | docker-compose.dev.yml | named volume was shadowing Linux-built node_modules from image | ~150 |
| 08:54 | Session end: 5 writes across 4 files (Dockerfile, .dockerignore, vite.config.ts, docker-compose.dev.yml) | 3 reads | ~1497 tok |
| 10:25 | Edited Dockerfile | 2→4 lines | ~43 |
| 10:27 | Edited Dockerfile | "/sbin/tini" → "/usr/bin/tini" | ~10 |
| 10:30 | Session end: 7 writes across 4 files (Dockerfile, .dockerignore, vite.config.ts, docker-compose.dev.yml) | 4 reads | ~1784 tok |
| 10:30 | Session end: 7 writes across 4 files (Dockerfile, .dockerignore, vite.config.ts, docker-compose.dev.yml) | 4 reads | ~1784 tok |

## Session: 2026-05-13 18:35

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 21:06 | Created src/providers/llm/types.ts | — | ~431 |
| 21:06 | Created src/providers/llm/pricing.ts | — | ~529 |
| 21:06 | Created src/providers/llm/anthropic.ts | — | ~625 |
| 21:07 | Created src/providers/llm/openai-compatible.ts | — | ~623 |
| 21:07 | Created src/providers/llm/retry.ts | — | ~479 |
| 21:07 | Created src/providers/llm/registry.ts | — | ~594 |
| 21:07 | Created src/providers/llm/index.ts | — | ~146 |
| 21:07 | Created src/bindings/llm.ts | — | ~646 |
| 21:08 | Created src/providers/llm/registry.test.ts | — | ~1558 |
| 21:08 | Created src/providers/llm/pricing.test.ts | — | ~239 |
| 21:08 | Created src/providers/llm/retry.test.ts | — | ~382 |
| 21:12 | Created src/bindings/llm.ts | — | ~411 |
| 21:12 | Created src/providers/llm/anthropic.ts | — | ~669 |
| 21:12 | Created src/providers/llm/anthropic.ts | — | ~672 |
| 21:12 | Created src/providers/llm/openai-compatible.ts | — | ~667 |
| 21:12 | Created src/providers/llm/pricing.ts | — | ~603 |
| 21:14 | Created src/core/state-machine.ts | — | ~478 |
| 21:14 | Created src/core/ports.ts | — | ~419 |
| 21:14 | Created src/core/semaphore.ts | — | ~309 |
| 21:15 | Created src/core/memory-state-store.ts | — | ~863 |
| 21:15 | Created src/core/decompose.ts | — | ~458 |
| 21:15 | Created src/core/orchestrator.ts | — | ~2102 |
| 21:16 | Created src/runtime/egress.ts | — | ~655 |
| 21:18 | Created src/agents/runners.ts | — | ~2302 |
| 21:18 | Created src/runtime/local.ts | — | ~1132 |
| 21:19 | Created src/core/orchestrator.ts | — | ~2199 |
| 21:19 | Created src/core/orchestrator.test.ts | — | ~1725 |
| 21:21 | Created src/core/semaphore.test.ts | — | ~312 |
| 21:21 | Created src/runtime/egress.test.ts | — | ~524 |
| 21:21 | Created src/runtime/local.test.ts | — | ~842 |
| 21:22 | Created src/local/config.ts | — | ~398 |
| 21:22 | Created src/local/log-hub.ts | — | ~336 |
| 21:23 | Created src/local/server.ts | — | ~1785 |
| 21:23 | Created src/local/config.test.ts | — | ~411 |
| 21:23 | Created src/local/server.test.ts | — | ~1114 |
| 21:24 | Created src/local/server.ts | — | ~1720 |
| 21:24 | Created src/local/main.ts | — | ~71 |
| 21:24 | Created package.json | — | ~436 |
| 21:24 | Created package.json | — | ~442 |
| 21:25 | Created jest.config.ts | — | ~929 |
| 21:28 | Created package.json | — | ~450 |
| 21:33 | Created src/providers/llm/types.ts | — | ~484 |
| 21:34 | Created src/providers/llm/anthropic.ts | — | ~705 |
| 21:34 | Created src/providers/llm/anthropic.ts | — | ~707 |
| 21:34 | Created src/providers/llm/openai-compatible.ts | — | ~700 |
| 21:34 | Created src/providers/llm/openai-compatible.ts | — | ~702 |
| 21:34 | Created src/providers/llm/registry.ts | — | ~616 |
| 21:34 | Created src/providers/llm/registry.ts | — | ~623 |
| 21:34 | Created src/runtime/local.ts | — | ~1410 |
| 21:34 | Created src/runtime/local.ts | — | ~1540 |
| 21:35 | Created src/core/ports.ts | — | ~455 |
| 21:35 | Created src/core/memory-state-store.ts | — | ~905 |
| 21:35 | Created src/core/orchestrator.ts | — | ~2603 |
| 21:36 | Created src/core/orchestrator.test.ts | — | ~2873 |
| 21:36 | Created src/runtime/local.test.ts | — | ~1157 |
| 22:00 | Created examples/crypto-payments/package.json | — | ~144 |
| 22:00 | Created examples/crypto-payments/tsconfig.json | — | ~116 |
| 22:00 | Created examples/crypto-payments/src/types.ts | — | ~868 |
| 22:00 | Created examples/crypto-payments/src/crypto.ts | — | ~201 |
| 22:00 | Created examples/crypto-payments/src/providers/mock.ts | — | ~765 |
| 22:02 | Created examples/crypto-payments/src/providers/stripe.ts | — | ~1656 |
| 22:02 | Created examples/crypto-payments/src/providers/coinbase.ts | — | ~1272 |
| 22:03 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1689 |
| 22:03 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1687 |
| 22:03 | Created examples/crypto-payments/src/providers/registry.ts | — | ~457 |
| 22:03 | Created examples/crypto-payments/src/config.ts | — | ~364 |
| 22:03 | Created examples/crypto-payments/src/payment-service.ts | — | ~550 |
| 22:04 | Created examples/crypto-payments/src/server.ts | — | ~982 |
| 22:04 | Created examples/crypto-payments/src/main.ts | — | ~202 |
| 22:04 | Created examples/crypto-payments/src/providers/registry.test.ts | — | ~1202 |
| 22:05 | Created examples/crypto-payments/src/payment-service.test.ts | — | ~488 |
| 22:06 | Created examples/crypto-payments/src/payment-service.test.ts | — | ~488 |
| 22:07 | Created examples/crypto-payments/package.json | — | ~145 |
| 22:08 | Created examples/crypto-payments/README.md | — | ~1255 |
| 22:13 | Created examples/crypto-payments/src/money.ts | — | ~503 |
| 22:13 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1701 |
| 22:13 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1744 |
| 22:13 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1751 |
| 22:13 | Created examples/crypto-payments/src/providers/paypal.ts | — | ~1884 |
| 22:13 | Created examples/crypto-payments/src/providers/coinbase.ts | — | ~1286 |
| 22:13 | Created examples/crypto-payments/src/providers/coinbase.ts | — | ~1315 |
| 22:14 | Created examples/crypto-payments/src/server.ts | — | ~1209 |
| 22:14 | Created examples/crypto-payments/src/money.test.ts | — | ~310 |
| 22:14 | Created examples/crypto-payments/src/providers/paypal.test.ts | — | ~1234 |
| 22:14 | Created examples/crypto-payments/src/providers/paypal.test.ts | — | ~1107 |
| 22:16 | Created examples/crypto-payments/src/server.ts | — | ~1215 |
| 22:16 | Created examples/crypto-payments/src/server.ts | — | ~1314 |
| 22:18 | Created .github/workflows/crypto-payments-ci.yml | — | ~286 |
| 22:19 | Created docs/technical-summary.md | — | ~1635 |
| 22:19 | Session end: 89 writes across 46 files (types.ts, pricing.ts, anthropic.ts, openai-compatible.ts, retry.ts) | 65 reads | ~117701 tok |
| 22:23 | Session end: 89 writes across 46 files (types.ts, pricing.ts, anthropic.ts, openai-compatible.ts, retry.ts) | 65 reads | ~117701 tok |
| 22:25 | Session end: 89 writes across 46 files (types.ts, pricing.ts, anthropic.ts, openai-compatible.ts, retry.ts) | 65 reads | ~117701 tok |
| 22:40 | Created .github/workflows/crypto-payments-ci.yml | — | ~327 |
| 22:45 | Session end: 90 writes across 46 files (types.ts, pricing.ts, anthropic.ts, openai-compatible.ts, retry.ts) | 65 reads | ~118314 tok |
