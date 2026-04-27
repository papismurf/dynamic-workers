import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import TaskCard, { TaskCardSkeleton } from '../components/TaskCard'
import UsageSidebar from '../components/UsageSidebar'
import { useTask } from '../hooks/useTask'

// ---------------------------------------------------------------------------
// Individual task card that fetches its own data
// ---------------------------------------------------------------------------

function LiveTaskCard({ taskId }: { taskId: string }) {
  const { task, isLoading, error } = useTask(taskId)

  if (isLoading) return <TaskCardSkeleton />

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
        Failed to load task <span className="font-mono">{taskId.slice(0, 8)}…</span>
      </div>
    )
  }

  if (!task) return null

  return <TaskCard task={task} showLink />
}

// ---------------------------------------------------------------------------
// Look-up by ID
// ---------------------------------------------------------------------------

function TaskLookup() {
  const [value, setValue] = useState('')
  const navigate = useNavigate()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const id = value.trim()
    if (id) navigate(`/tasks/${id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2" aria-label="Look up task by ID">
      <label htmlFor="task-lookup" className="sr-only">
        Task ID
      </label>
      <input
        id="task-lookup"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Look up task by ID…"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        aria-label="Navigate to task"
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Go
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------

interface HomePageProps {
  recentTaskIds: string[]
  onTasksSubmitted: (ids: string[]) => void
}

export default function HomePage({ recentTaskIds, onTasksSubmitted }: HomePageProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-slate-900">dynamic-workers</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 font-medium">
              Task UI
            </span>
          </div>
          <a
            href="https://github.com/ag-ui-protocol/ag-ui"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-slate-600"
            aria-label="AG-UI protocol on GitHub"
          >
            AG-UI &rarr;
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: Submit form */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <h1 className="text-base font-semibold text-slate-900 mb-4">New Task</h1>
              <TaskForm onTasksSubmitted={onTasksSubmitted} />
            </div>
          </div>

          {/* Right: Task list + usage */}
          <div className="lg:col-span-2 space-y-6">

            {/* Recent tasks */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Recent Tasks
                  {recentTaskIds.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-slate-400">
                      ({recentTaskIds.length})
                    </span>
                  )}
                </h2>
                <TaskLookup />
              </div>

              {recentTaskIds.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <p className="text-sm text-slate-400">
                    No tasks submitted this session.
                  </p>
                  <p className="text-xs text-slate-300 mt-1">
                    Submit a task or look one up by ID.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTaskIds.map((id) => (
                    <LiveTaskCard key={id} taskId={id} />
                  ))}
                </div>
              )}
            </div>

            {/* Usage sidebar */}
            <UsageSidebar />
          </div>
        </div>
      </main>
    </div>
  )
}
