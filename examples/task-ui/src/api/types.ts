// Mirrors src/types.ts from the orchestrator Worker.
// Keep in sync when adding new fields to the Worker.

export type AgentType =
  | 'codegen'
  | 'test'
  | 'review'
  | 'refactor'
  | 'debug'
  | 'dependency'

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'review'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RepoContext {
  owner: string
  repo: string
  branch: string
  baseBranch: string
  files: Record<string, string>
}

export interface AgentConfig {
  model?: string
  provider?: 'anthropic' | 'openai'
  maxTokens?: number
  temperature?: number
  maxRetries?: number
}

export interface TaskRequest {
  description: string
  agentType: AgentType
  repo: RepoContext
  config?: AgentConfig
  parentTaskId?: string
}

export interface SubTask {
  id: string
  agentType: AgentType
  description: string
  context: Record<string, unknown>
  dependencies: string[]
}

export interface ReviewComment {
  file: string
  line: number
  severity: 'info' | 'warning' | 'error'
  message: string
  suggestion?: string
}

export interface TestResult {
  name: string
  passed: boolean
  error?: string
  durationMs: number
}

export interface AgentOutput {
  files: Record<string, string>
  summary: string
  diff?: string
  prUrl?: string
  testResults?: TestResult[]
  reviewComments?: ReviewComment[]
}

export interface CostBreakdown {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  cpuTimeMs: number
  subrequests: number
}

export interface AgentResult {
  subtaskId: string
  agentType: AgentType
  success: boolean
  output: AgentOutput
  error?: string
  cost: CostBreakdown
  durationMs: number
}

export interface TaskState {
  id: string
  status: TaskStatus
  request: TaskRequest
  subtasks: SubTask[]
  results: Record<string, AgentResult>
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  reviewUrl?: string
  cost?: CostBreakdown
}

// API request / response shapes

export interface CreateTaskRequest {
  tasks: TaskRequest[]
}

export interface CreateTaskResponse {
  taskIds: string[]
}

export interface TaskStatusResponse {
  task: TaskState
}

export interface ReviewDecision {
  taskId: string
  decision: 'approve' | 'reject' | 'revise'
  feedback?: string
}

export interface UsageResponse {
  tasks: Array<{ taskId: string; cost: CostBreakdown }>
  aggregate: CostBreakdown
}

export interface LogEntry {
  level: string
  message: string
  timestamp: number
  workerId?: string
  taskId?: string
}
