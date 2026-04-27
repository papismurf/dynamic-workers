import type {
  CreateTaskRequest,
  CreateTaskResponse,
  TaskStatusResponse,
  ReviewDecision,
  UsageResponse,
} from './types'

const BASE = (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'http://localhost:8787'

interface ApiError {
  error?: string
  message?: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let body: ApiError = {}
    try {
      body = (await res.json()) as ApiError
    } catch {
      // non-JSON error body
    }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

export function submitTasks(req: CreateTaskRequest): Promise<CreateTaskResponse> {
  return apiFetch<CreateTaskResponse>('/tasks', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function getTask(taskId: string): Promise<TaskStatusResponse> {
  return apiFetch<TaskStatusResponse>(`/tasks/${taskId}`)
}

export async function submitReview(taskId: string, decision: ReviewDecision): Promise<void> {
  await apiFetch<unknown>(`/tasks/${taskId}/review`, {
    method: 'POST',
    body: JSON.stringify(decision),
  })
}

export function getUsage(since?: number): Promise<UsageResponse> {
  const qs = since !== undefined ? `?since=${since}` : ''
  return apiFetch<UsageResponse>(`/usage${qs}`)
}

/** Derive the WebSocket base URL from the HTTP base URL. */
export function getWsBase(): string {
  return BASE.replace(/^https/, 'wss').replace(/^http/, 'ws')
}
