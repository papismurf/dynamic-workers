# API Reference

All endpoints are served by the Orchestrator Worker. Base URL depends on your deployment (e.g., `https://agent-orchestrator.<subdomain>.workers.dev`).

---

## Health Check

### `GET /` or `GET /health`

Returns service status.

**Response** `200 OK`

```json
{
  "service": "agent-orchestrator",
  "status": "healthy",
  "version": "0.1.0"
}
```

---

## Tasks

### `POST /tasks`

Create one or more agent tasks. Tasks are executed asynchronously — the response returns immediately with task IDs.

**Request Body**

```json
{
  "tasks": [
    {
      "description": "Add input validation to the user registration endpoint",
      "agentType": "codegen",
      "repo": {
        "owner": "myorg",
        "repo": "my-api",
        "branch": "agent/validation",
        "baseBranch": "main",
        "files": {
          "src/routes/register.ts": "... file contents ..."
        }
      },
      "config": {
        "model": "claude-sonnet-4-20250514",
        "provider": "anthropic",
        "maxTokens": 8192,
        "temperature": 0,
        "maxRetries": 3
      }
    }
  ]
}
```

**Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `tasks` | `TaskRequest[]` | Yes | Array of tasks to execute |
| `tasks[].description` | `string` | Yes | Natural language description of the work |
| `tasks[].agentType` | `AgentType` | Yes | One of: `codegen`, `test`, `review`, `refactor`, `debug`, `dependency` |
| `tasks[].repo` | `RepoContext` | Yes | Target repository information |
| `tasks[].repo.owner` | `string` | Yes | GitHub org or user |
| `tasks[].repo.repo` | `string` | Yes | Repository name |
| `tasks[].repo.branch` | `string` | Yes | Working branch for agent commits |
| `tasks[].repo.baseBranch` | `string` | Yes | Base branch for diffs and PRs |
| `tasks[].repo.files` | `Record<string, string>` | Yes | Map of file paths to their contents |
| `tasks[].config` | `AgentConfig` | No | Override default agent settings |
| `tasks[].config.model` | `string` | No | LLM model identifier (default: `claude-sonnet-4-20250514`) |
| `tasks[].config.provider` | `string` | No | `"anthropic"` or `"openai"` (default: `anthropic`) |
| `tasks[].config.maxTokens` | `number` | No | Max response tokens (default: `4096`) |
| `tasks[].config.temperature` | `number` | No | Sampling temperature (default: `0`) |
| `tasks[].config.maxRetries` | `number` | No | Self-heal retry limit |
| `tasks[].parentTaskId` | `string` | No | Link to a parent task for chaining |

**Response** `201 Created`

```json
{
  "taskIds": [
    "550e8400-e29b-41d4-a716-446655440000"
  ]
}
```

---

### `GET /tasks/:taskId`

Get the current state of a task, including subtask results and cost breakdown.

**Response** `200 OK`

```json
{
  "task": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "review",
    "request": { "...original request..." },
    "subtasks": [
      {
        "id": "a1b2c3d4",
        "agentType": "codegen",
        "description": "Add input validation...",
        "dependencies": []
      },
      {
        "id": "e5f6g7h8",
        "agentType": "test",
        "description": "Write tests for: Add input validation...",
        "dependencies": ["a1b2c3d4"]
      }
    ],
    "results": {
      "a1b2c3d4": {
        "subtaskId": "a1b2c3d4",
        "agentType": "codegen",
        "success": true,
        "output": {
          "files": { "src/routes/register.ts": "...updated code..." },
          "summary": "Generated 1 file(s)"
        },
        "cost": {
          "inputTokens": 2340,
          "outputTokens": 890,
          "totalTokens": 3230,
          "estimatedCostUsd": 0.0204,
          "cpuTimeMs": 4520,
          "subrequests": 0
        },
        "durationMs": 4520
      }
    },
    "cost": {
      "inputTokens": 5680,
      "outputTokens": 1920,
      "totalTokens": 7600,
      "estimatedCostUsd": 0.0459,
      "cpuTimeMs": 9340,
      "subrequests": 0
    },
    "createdAt": 1712300000000,
    "updatedAt": 1712300009340
  }
}
```

**Response** `404 Not Found` — if the task ID does not exist.

---

### `POST /tasks/:taskId/review`

Submit a human review decision for a task in the `review` state. This is the human-in-the-loop gate.

**Request Body**

```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "decision": "approve",
  "feedback": "Looks good, ship it."
}
```

**Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `taskId` | `string` | Yes | The task to review |
| `decision` | `string` | Yes | `"approve"`, `"reject"`, or `"revise"` |
| `feedback` | `string` | For `reject`/`revise` | Explanation or revision instructions |

**Decision behaviors:**

| Decision | Effect |
|---|---|
| `approve` | Task moves to `approved` → orchestrator creates a GitHub PR → `completed` |
| `reject` | Task moves to `failed` with the feedback recorded as the error |
| `revise` | Task moves to `failed`, then a new execution starts with the original description plus the revision feedback appended |

**Response** `200 OK`

```json
{ "status": "approved" }
```

**Response** `400 Bad Request` — if the task is not in the `review` state.

---

### `WS /tasks/:taskId/stream`

Open a WebSocket connection to receive real-time logs from the agent's execution. Connect with a standard WebSocket client:

```javascript
const ws = new WebSocket("wss://your-worker.workers.dev/tasks/550e8400/stream");

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // message.type === "logs"
  // message.data === LogEntry[]
  console.log(message.data);
};
```

**Message format:**

```json
{
  "type": "logs",
  "data": [
    {
      "level": "log",
      "message": "[codegen] Wrote src/routes/register.ts (2340 bytes)",
      "timestamp": 1712300005000,
      "workerId": "550e8400-a1b2c3d4",
      "taskId": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

On connection, any logs already captured are sent immediately as the first message. New logs stream as they arrive.

---

## Usage & Cost Tracking

### `GET /usage`

Returns per-task cost breakdowns and aggregate totals.

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `since` | `number` (epoch ms) | Only return records after this timestamp |

**Response** `200 OK`

```json
{
  "tasks": [
    {
      "taskId": "550e8400-e29b-41d4-a716-446655440000",
      "cost": {
        "inputTokens": 5680,
        "outputTokens": 1920,
        "totalTokens": 7600,
        "estimatedCostUsd": 0.0459,
        "cpuTimeMs": 9340,
        "subrequests": 12
      }
    }
  ],
  "aggregate": {
    "inputTokens": 45000,
    "outputTokens": 12000,
    "totalTokens": 57000,
    "estimatedCostUsd": 0.315,
    "cpuTimeMs": 82000,
    "subrequests": 96
  }
}
```

---

## Error Responses

All error responses follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable description of the problem"
}
```

| Status | Error Code | When |
|---|---|---|
| `400` | (varies) | Invalid request body, missing fields, invalid state transition |
| `404` | `"Not found"` | Unknown endpoint or task ID |
| `500` | `"internal_error"` | Unhandled exception in the orchestrator |

---

## Type Reference

All request/response types are defined in `src/types.ts`. Key types:

- `AgentType` — `"codegen" | "test" | "review" | "refactor" | "debug" | "dependency"`
- `TaskStatus` — `"pending" | "assigned" | "running" | "review" | "approved" | "completed" | "failed" | "cancelled"`
- `TaskRequest` — input to `POST /tasks`
- `TaskState` — full task object returned by `GET /tasks/:id`
- `AgentResult` — per-subtask execution result
- `CostBreakdown` — token and resource usage metrics
- `ReviewDecision` — input to `POST /tasks/:id/review`
