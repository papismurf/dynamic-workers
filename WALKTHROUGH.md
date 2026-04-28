# Walkthrough: Adding a DataTable Feature to a Plotly Dash App

This guide walks through the complete end-to-end flow of using the Task UI to instruct
the Dynamic Workers agents to build a new filterable, sortable DataTable component in
your Plotly Dash application — from filling in the form to approving the finished code.

---

## Prerequisites

Make sure both containers are running before you start:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Verify:
- Orchestrator: `curl http://localhost:8787/health` → `{"status":"healthy",...}`
- Task UI: open `http://localhost:5173` in your browser

---

## Overview of the flow

```
Fill form → Submit → Agent runs (live logs) → Review panel → Approve → PR created
                                                           ↓
                                               Request Revision → Agent retries
```

Each step is covered below in order.

---

## Step 1 — Open the Task UI

Navigate to `http://localhost:5173`.

You will see a two-column layout:
- **Left panel** — the New Task form
- **Right panel** — Recent Tasks list and the Usage sidebar

The form always defaults to `codegen` agent type, which is exactly what you need to
generate new Dash code.

---

## Step 2 — Write the task description

Click into the **Description** textarea (top of the left panel) and describe exactly
what you want the agent to build. Be specific — the more detail you give, the less
revision you will need later.

**Example description for this walkthrough:**

```
Add a DataTable to the sales dashboard page that displays data from the ClickHouse
`sales_events` table. Requirements:
- Use dash_ag_grid (AgGrid) component, not the legacy dash_table.DataTable
- Columns: event_id, product_name, region, quantity, unit_price, total_value, event_ts
- Server-side pagination: 100 rows per page, controlled by dcc.Store('pagination-state')
- Column filters: text filter on product_name and region, number filter on quantity/unit_price
- Sorting: single-column sort, passes sort model back to ClickHouse ORDER BY clause
- The ClickHouse query must use parametrized queries via clickhouse_connect
- Loading state: show dcc.Loading spinner while data fetches
- Place the component in pages/sales.py and the ClickHouse query helper in data/sales_queries.py
```

> The description field requires a minimum of 10 characters and the form will show a
> validation error if it is left too short.

---

## Step 3 — Select the Agent Type

The **Agent Type** dropdown is directly below the description. Leave it set to
**`codegen`** for this task.

The subtitle below the dropdown will read:
> *Generate new code from a natural language specification*

Available agent types for reference:

| Type | Use it when you want to… |
|---|---|
| `codegen` | Generate new code from a description |
| `test` | Write pytest tests for existing code |
| `review` | Review code for bugs and security issues |
| `refactor` | Restructure code without changing behaviour |
| `debug` | Diagnose and fix a failing test or runtime error |
| `dependency` | Update or audit Python package dependencies |

---

## Step 4 — Fill in the Repository section

The **Repository** fieldset tells the agent where to read and write code. All four
fields are required.

| Field | Example value | Notes |
|---|---|---|
| **Owner** | `myorg` | Your GitHub user or organisation name |
| **Repository** | `dash-sales-dashboard` | Exact repo name — no URL, no `.git` |
| **Working Branch** | `agent/datatable-feature` | Auto-filled with `agent/task-<timestamp>`. You can rename it. The agent commits to this branch. |
| **Base Branch** | `main` | The branch the PR will be opened against when you approve |

> The working branch is created in your repo automatically when the agent first
> commits. You do not need to create it manually.

---

## Step 5 — Add file context (optional but strongly recommended)

The **Files** section lets you paste existing code so the agent can match your
project's conventions and avoid writing code that clashes with what already exists.

Click **+ Add File** to add each file. You will see two fields per entry:
- **File path** — relative path in your repo (e.g. `pages/sales.py`)
- **Content** — paste the current file contents here

For the DataTable task, add these files as context:

### File 1 — existing sales page
```
File path:  pages/sales.py
Content:    <paste current contents of pages/sales.py>
```

### File 2 — ClickHouse connection helper
```
File path:  data/db.py
Content:    <paste current contents of data/db.py>
```

### File 3 — app entry point (so the agent knows your layout structure)
```
File path:  app.py
Content:    <paste current contents of app.py>
```

### File 4 — requirements.txt (so the agent knows which packages are installed)
```
File path:  requirements.txt
Content:    <paste current contents of requirements.txt>
```

> If you do not add file context, the agent will still generate code — it just will
> not know your existing variable names, import paths, or callback patterns, and you
> may need a revision round. Adding context produces better first-pass results.

To remove a file entry, click the **✕** button on the right side of its row.

---

## Step 6 — Advanced Config (optional)

Click **Advanced Config** to expand the accordion. Leave everything at defaults for
most tasks. You may want to change:

| Setting | When to change it |
|---|---|
| **Provider** | Switch from Anthropic to OpenAI if you prefer GPT-4o for this task |
| **Model** | Pin to a specific model version, e.g. `claude-opus-4-20250514` for maximum quality |
| **Max Tokens** | Increase to `16384` if the agent is generating many large files and getting cut off |
| **Max Retries** | Increase from `3` if your repo has flaky network and jobs sometimes fail transiently |
| **Temperature** | Drag toward 0 (Precise) for code tasks — deterministic output is almost always what you want |

---

## Step 7 — Submit the task

Click **Submit Task** at the bottom of the form.

The button will show **Submitting…** briefly while the orchestrator accepts the task.
Once accepted, the UI automatically navigates to the **Task Detail page** for that task
(`/tasks/<task-id>`).

You will also see the task appear in the **Recent Tasks** list on the right panel so
you can return to it from the home page later.

---

## Step 8 — Watch the Task Detail page

The Task Detail page (`http://localhost:5173/tasks/<task-id>`) has three panels:

### Task Card (top-left)

Shows the current status with a colour-coded badge:

| Badge colour | Status | Meaning |
|---|---|---|
| Blue (pulsing) | `running` | Agent is actively generating code |
| Grey | `pending` / `assigned` | Queued, not started yet |
| Yellow | `review` | Agent finished — your approval is needed |
| Green | `completed` | Approved and PR created |
| Red | `failed` | Agent hit an unrecoverable error |

The card also shows:
- The repo and working branch name
- Subtask list with per-subtask `✓` / `✗` / `○` indicators
- Token count and estimated cost once the agent finishes

### Live Logs (top-right)

A terminal-style streaming panel that shows real-time log output from the agent
while it is running. You will see lines like:

```
[codegen] Starting: Add a DataTable to the sales dashboard page...
[codegen] File pages/sales.py not found, will create new
[codegen] Wrote pages/sales.py (3,241 bytes)
[codegen] Wrote data/sales_queries.py (1,187 bytes)
[codegen] Complete in 14,302ms, commit: a3f9e12
```

The connected indicator (green dot) shows the WebSocket is live. Once the task
reaches a terminal status (`completed`, `failed`, `review`) the stream stops and
the indicator shows *Task is no longer active — streaming stopped*.

### Agent Results (bottom, after task finishes)

A list of all subtask results, each showing:
- Agent type badge (`codegen`, `test`, etc.)
- Success/failure indicator
- Files written (clickable chip list)
- Token count and cost for that subtask

---

## Step 9 — Human review

When the agent finishes generating code, the task status changes to `review` and a
yellow **Human Review Required** panel appears below the logs.

The review panel shows:

### Files changed
A list of every file the agent wrote, e.g.:
```
pages/sales.py
data/sales_queries.py
```

### Review comments
If a review agent ran as a subtask, its findings are listed here by severity:
- **Red** — `error`: bugs, security issues (e.g. non-parametrized ClickHouse query)
- **Yellow** — `warning`: performance issues (e.g. missing `prevent_initial_call`)
- **Grey** — `info`: style suggestions

### Diff viewer
A syntax-highlighted git diff of every change the agent made, so you can see exactly
what was added or modified without leaving the browser.

### Making your decision

You have three options:

#### Approve
Click **Approve** then **Confirm approve**.

The orchestrator merges the working branch and opens a pull request against your base
branch. A **View PR on GitHub →** link appears immediately. The task status turns
green (`completed`).

#### Request Revision
Click **Request Revision**, then type your feedback in the text box that appears, then
click **Confirm revise**.

**Example revision feedback:**
```
The DataTable is missing the dcc.Loading wrapper — add it around the AgGrid component.
Also the ClickHouse query in sales_queries.py is missing the LIMIT clause for pagination.
```

The agent will re-run with your feedback injected into its prompt and produce an
updated diff. The task returns to `running` and then `review` again. You can
iterate as many times as you need.

#### Reject
Click **Reject**, enter a reason, then click **Confirm reject**.

The task moves to `failed` with your rejection reason recorded. No PR is created.
Submit a new task if you want to try again with a different description.

---

## Step 10 — Follow-up: run the Test agent

After approving the DataTable implementation, submit a second task to generate tests
for it. Go back to the home page (`← Home` in the top-left) and fill in a new task:

| Field | Value |
|---|---|
| **Description** | `Write pytest tests for the new AgGrid DataTable in pages/sales.py and data/sales_queries.py. Test the ClickHouse query builder with mocked clickhouse_connect, and test the Dash callbacks using TestClient.` |
| **Agent Type** | `test` |
| **Owner / Repo / Branches** | Same as before |
| **Files** | Add `pages/sales.py` and `data/sales_queries.py` from the branch the agent just wrote |

The test agent automatically detects `requirements.txt` in the file context and sets
the framework to **pytest**. It will generate a `conftest.py` with fixtures and
`tests/test_sales_datatable.py` with mocked ClickHouse calls.

---

## Step 11 — Look up a past task by ID

If you lose track of a task, use the **Look up task by ID** input in the top-right
of the home page. Paste the full task ID (or the first 8 characters) and click **Go**
to jump directly to its detail page.

Task IDs are shown on every task card. You can click the short ID on any card to copy
it to your clipboard.

---

## Step 12 — Monitor costs in the Usage sidebar

The **Usage** sidebar on the home page shows aggregate token consumption and estimated
cost across all tasks. Use the time filter buttons — **Today**, **7 days**, **All time**
— to scope the view. The sidebar refreshes every 30 seconds automatically.

A typical DataTable `codegen` task costs approximately:
- ~3,000–6,000 input tokens (your description + file context)
- ~2,000–4,000 output tokens (generated code)
- ~$0.02–$0.08 estimated at Anthropic Sonnet pricing

---

## Quick reference: full field values for this walkthrough

| Field | Value used in this example |
|---|---|
| Description | *See Step 2* |
| Agent Type | `codegen` |
| Owner | `myorg` |
| Repository | `dash-sales-dashboard` |
| Working Branch | `agent/datatable-feature` |
| Base Branch | `main` |
| Files | `pages/sales.py`, `data/db.py`, `app.py`, `requirements.txt` |
| Provider | Default (Anthropic) |
| Model | Default (`claude-sonnet-4-20250514`) |
| Temperature | 0 (Precise) |

---

## Troubleshooting

**The form shows a validation error on Description**
The description must be at least 10 characters. Expand your description — more detail
also produces better output.

**Task stays in `pending` for more than 30 seconds**
Check that the orchestrator container is still running:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
curl http://localhost:8787/health
```

**Task fails immediately with an ENOENT or auth error**
Check your `.dev.vars` file. The agent needs `GITHUB_PAT` with `repo` scope to read
and write to your repository, and `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to call
the LLM.

**Log stream shows "clickhouse_connect not found"**
The agent generates code for packages it expects to be installed. If `clickhouse_connect`
is not in your `requirements.txt`, add it as a file entry in the Files section so the
agent knows to import from the correct package or to add it to requirements.

**Review panel does not appear**
Hard-refresh the page (`Ctrl+Shift+R`). The task must be in `review` status for the
panel to render — check the status badge on the TaskCard.
