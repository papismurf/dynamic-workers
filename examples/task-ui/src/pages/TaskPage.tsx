import { Link, useParams } from 'react-router-dom'
import { useTask } from '../hooks/useTask'
import { useTaskStream } from '../hooks/useTaskStream'
import TaskCard, { TaskCardSkeleton } from '../components/TaskCard'
import LogStream from '../components/LogStream'
import ReviewPanel from '../components/ReviewPanel'

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
      role="alert"
    >
      <strong>Error:</strong> {message}
    </div>
  )
}

function NotFound({ taskId }: { taskId: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-sm font-medium text-slate-700 mb-1">Task not found</p>
      <p className="text-xs text-slate-400 font-mono mb-4">{taskId}</p>
      <Link
        to="/"
        className="text-sm text-blue-600 hover:underline"
        aria-label="Return to home"
      >
        &larr; Return home
      </Link>
    </div>
  )
}

export default function TaskPage() {
  const { taskId = '' } = useParams<{ taskId: string }>()
  const { task, isLoading, error, refetch } = useTask(taskId)

  const isActiveTask =
    !!task &&
    ['pending', 'assigned', 'running'].includes(task.status)

  const { logs, connected } = useTaskStream(taskId, isActiveTask)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center gap-4">
          <Link
            to="/"
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
            aria-label="Back to home"
          >
            &larr; Home
          </Link>
          <span className="text-slate-300" aria-hidden="true">/</span>
          <span className="text-sm font-medium text-slate-800 font-mono truncate max-w-xs">
            {taskId}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TaskCardSkeleton />
            <div className="rounded-xl border border-slate-700 bg-slate-950 h-64 animate-pulse" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <ErrorBanner message={error.message} />
        )}

        {/* Not found */}
        {!isLoading && !error && !task && (
          <NotFound taskId={taskId} />
        )}

        {/* Task loaded */}
        {task && (
          <>
            {/* Top row: TaskCard + LogStream */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Task card */}
              <div className="space-y-4">
                <TaskCard task={task} showLink={false} />

                {/* Status message */}
                {task.status === 'review' && (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-xs text-yellow-800">
                    This task is awaiting your review. See the review panel below.
                  </div>
                )}
                {task.status === 'completed' && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-xs text-green-800">
                    Task completed successfully.
                    {task.reviewUrl && (
                      <a
                        href={task.reviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 font-medium underline hover:no-underline"
                        aria-label="View pull request"
                      >
                        View PR &rarr;
                      </a>
                    )}
                  </div>
                )}
                {task.status === 'failed' && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
                    {task.error ?? 'Task failed without an error message.'}
                  </div>
                )}
              </div>

              {/* Log stream */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700">Live Logs</h2>
                  {!isActiveTask && (
                    <span className="text-xs text-slate-400 italic">
                      Task is no longer active — streaming stopped
                    </span>
                  )}
                </div>
                <LogStream logs={logs} connected={connected} />
              </div>
            </div>

            {/* Review panel */}
            {task.status === 'review' && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Review</h2>
                <ReviewPanel
                  task={task}
                  onReviewed={() => void refetch()}
                />
              </div>
            )}

            {/* Per-subtask results detail */}
            {Object.keys(task.results ?? {}).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Agent Results</h2>
                <div className="space-y-3">
                  {Object.entries(task.results).map(([id, result]) => (
                    <div
                      key={id}
                      className="rounded-xl border border-slate-200 bg-white shadow-sm p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-mono ${result.success ? 'text-green-600' : 'text-red-600'}`}
                            aria-hidden="true"
                          >
                            {result.success ? '✓' : '✗'}
                          </span>
                          <span className="text-sm font-medium text-slate-800">
                            {result.agentType}
                          </span>
                          <span className="font-mono text-xs text-slate-400">{id}</span>
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {(result.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>

                      {result.output.summary && (
                        <p className="text-xs text-slate-600 mb-2">{result.output.summary}</p>
                      )}

                      {Object.keys(result.output.files ?? {}).length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500 font-medium mb-1">Files</p>
                          <ul className="flex flex-wrap gap-1">
                            {Object.keys(result.output.files).map((f) => (
                              <li
                                key={f}
                                className="font-mono text-xs bg-slate-100 text-slate-700 rounded px-2 py-0.5"
                              >
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {result.error && (
                        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
                          {result.error}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                        <span>{result.cost.totalTokens.toLocaleString()} tokens</span>
                        <span>·</span>
                        <span>${result.cost.estimatedCostUsd.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
