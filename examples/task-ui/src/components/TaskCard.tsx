import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { TaskState, TaskStatus, AgentType } from '../api/types'

// ---------------------------------------------------------------------------
// Status badge styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  assigned: 'bg-slate-100 text-slate-600',
  running: 'bg-blue-100 text-blue-700',
  review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-400',
}

const AGENT_COLORS: Record<AgentType, string> = {
  codegen: 'bg-purple-100 text-purple-700',
  test: 'bg-blue-100 text-blue-700',
  review: 'bg-orange-100 text-orange-700',
  refactor: 'bg-cyan-100 text-cyan-700',
  debug: 'bg-red-100 text-red-700',
  dependency: 'bg-green-100 text-green-700',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const isActive = status === 'running' || status === 'assigned'
  const isReview = status === 'review'
  const isCancelled = status === 'cancelled'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]} ${isCancelled ? 'line-through' : ''}`}
    >
      {isActive && (
        <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
      )}
      {isReview && <span aria-hidden="true">!</span>}
      {status}
    </span>
  )
}

function AgentBadge({ type }: { type: AgentType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${AGENT_COLORS[type]}`}
    >
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

export function TaskCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="h-5 w-16 rounded-full bg-slate-200" />
      </div>
      <div className="h-3 w-48 rounded bg-slate-200 mb-2" />
      <div className="h-3 w-full rounded bg-slate-200 mb-1" />
      <div className="h-3 w-3/4 rounded bg-slate-200" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: TaskState
  /** When true, shows a "View details" link. Set to false on the TaskPage itself. */
  showLink?: boolean
}

export default function TaskCard({ task, showLink = true }: TaskCardProps) {
  const [copied, setCopied] = useState(false)

  function copyId() {
    void navigator.clipboard.writeText(task.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const subtaskList = task.subtasks ?? []
  const resultMap = task.results ?? {}

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-start gap-2 justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={copyId}
            aria-label="Copy task ID"
            title="Click to copy task ID"
            className="font-mono text-xs text-slate-400 hover:text-slate-700 transition-colors truncate max-w-[180px]"
          >
            {copied ? 'Copied!' : task.id.slice(0, 8) + '…'}
          </button>
          <AgentBadge type={task.request.agentType} />
        </div>
        <StatusBadge status={task.status} />
      </div>

      {/* Description */}
      <p className="text-sm text-slate-700 mb-3 line-clamp-2">{task.request.description}</p>

      {/* Repo */}
      <p className="text-xs text-slate-400 mb-3">
        {task.request.repo.owner}/{task.request.repo.repo} ·{' '}
        <span className="font-mono">{task.request.repo.branch}</span>
      </p>

      {/* Subtasks */}
      {subtaskList.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-slate-500 mb-1.5">Subtasks</p>
          <ul className="space-y-1">
            {subtaskList.map((st) => {
              const result = resultMap[st.id]
              const icon = result === undefined
                ? '○'
                : result.success
                ? '✓'
                : '✗'
              const color = result === undefined
                ? 'text-slate-400'
                : result.success
                ? 'text-green-600'
                : 'text-red-600'

              return (
                <li key={st.id} className="flex items-center gap-2 text-xs">
                  <span className={`font-mono ${color}`} aria-hidden="true">{icon}</span>
                  <span className="text-slate-600 truncate">{st.agentType}</span>
                  {result?.durationMs !== undefined && (
                    <span className="text-slate-400 ml-auto shrink-0">
                      {(result.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Cost */}
      {task.cost && (
        <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
          <span>{task.cost.totalTokens.toLocaleString()} tokens</span>
          <span className="text-slate-300">·</span>
          <span>${task.cost.estimatedCostUsd.toFixed(4)}</span>
        </div>
      )}

      {/* Error */}
      {task.error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
          {task.error}
        </p>
      )}

      {/* Review URL (PR link) */}
      {task.reviewUrl && (
        <a
          href={task.reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mb-3"
          aria-label="View pull request on GitHub"
        >
          View PR on GitHub &rarr;
        </a>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-400">
          {new Date(task.createdAt).toLocaleTimeString()}
        </span>
        {showLink && (
          <Link
            to={`/tasks/${task.id}`}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
            aria-label={`View details for task ${task.id.slice(0, 8)}`}
          >
            View details &rarr;
          </Link>
        )}
      </div>
    </div>
  )
}
