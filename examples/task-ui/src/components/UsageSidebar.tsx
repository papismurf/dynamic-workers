import { useState } from 'react'
import { useUsage, type TimeFilter } from '../hooks/useUsage'

const FILTER_LABELS: Record<TimeFilter, string> = {
  today: 'Today',
  '7days': '7 days',
  all: 'All time',
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="h-3 w-24 rounded bg-slate-200 animate-pulse" />
      <div className="h-3 w-16 rounded bg-slate-200 animate-pulse" />
    </div>
  )
}

export default function UsageSidebar() {
  const [filter, setFilter] = useState<TimeFilter>('all')
  const { data, isLoading, error } = useUsage(filter)

  const aggregate = data?.aggregate
  const tasks = data?.tasks ?? []

  return (
    <aside className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">Usage</h2>
        <div
          className="flex rounded-lg border border-slate-200 overflow-hidden text-xs"
          role="group"
          aria-label="Time filter"
        >
          {(Object.keys(FILTER_LABELS) as TimeFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-2 py-1 transition-colors ${
                filter === f
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-3" role="alert">
          Failed to load usage data
        </p>
      )}

      {/* Aggregate stats */}
      <div className="divide-y divide-slate-100 mb-4">
        {isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : aggregate ? (
          <>
            <StatRow label="Tasks" value={tasks.length.toString()} />
            <StatRow
              label="Input tokens"
              value={aggregate.inputTokens.toLocaleString()}
            />
            <StatRow
              label="Output tokens"
              value={aggregate.outputTokens.toLocaleString()}
            />
            <StatRow
              label="Estimated cost"
              value={`$${aggregate.estimatedCostUsd.toFixed(4)}`}
            />
            <StatRow
              label="CPU time"
              value={`${(aggregate.cpuTimeMs / 1000).toFixed(1)}s`}
            />
          </>
        ) : (
          <p className="text-xs text-slate-400 py-2">No usage data</p>
        )}
      </div>

      {/* Per-task breakdown */}
      {tasks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">Per task</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tasks.map(({ taskId, cost }) => (
              <div
                key={taskId}
                className="flex items-center justify-between text-xs rounded-lg bg-slate-50 px-2 py-1.5"
              >
                <span className="font-mono text-slate-500 truncate max-w-[100px]">
                  {taskId.slice(0, 8)}…
                </span>
                <span className="tabular-nums text-slate-700">
                  ${cost.estimatedCostUsd.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
