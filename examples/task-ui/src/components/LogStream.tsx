import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '../api/types'

const LEVEL_COLORS: Record<string, string> = {
  log: 'text-slate-200',
  info: 'text-slate-200',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-slate-500',
}

function logColor(level: string): string {
  return LEVEL_COLORS[level] ?? 'text-slate-200'
}

interface LogStreamProps {
  logs: LogEntry[]
  connected: boolean
}

export default function LogStream({ logs, connected }: LogStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copyLabel, setCopyLabel] = useState('Copy all')

  // Auto-scroll to bottom when new logs arrive (if user hasn't scrolled up)
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  function copyAll() {
    const text = logs
      .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.level}] ${l.message}`)
      .join('\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy all'), 1500)
    })
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-700 bg-slate-950 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-900">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`}
            aria-label={connected ? 'WebSocket connected' : 'WebSocket disconnected'}
          />
          <span className="text-xs text-slate-400 font-medium">
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <span className="text-xs text-slate-600 ml-1">
            {logs.length} {logs.length === 1 ? 'line' : 'lines'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              type="button"
              onClick={() => {
                setAutoScroll(true)
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="text-xs text-blue-400 hover:text-blue-300"
              aria-label="Scroll to latest log"
            >
              &darr; Latest
            </button>
          )}
          <button
            type="button"
            onClick={copyAll}
            disabled={logs.length === 0}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Copy all log lines to clipboard"
          >
            {copyLabel}
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="log-scroll h-72 overflow-y-auto p-4 font-mono text-xs space-y-0.5"
      >
        {logs.length === 0 ? (
          <p className="text-slate-600 italic">Waiting for logs{connected ? '…' : ' (not connected)'}</p>
        ) : (
          logs.map((entry, idx) => (
            <div key={idx} className="flex gap-2 leading-5">
              <span className="text-slate-600 shrink-0 tabular-nums">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              {entry.workerId && (
                <span className="text-slate-600 shrink-0 truncate max-w-[120px]">
                  [{entry.workerId.slice(0, 12)}]
                </span>
              )}
              <span className={`break-all ${logColor(entry.level)}`}>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
