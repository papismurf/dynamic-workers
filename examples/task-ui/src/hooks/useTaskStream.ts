import { useEffect, useRef, useState } from 'react'
import { getWsBase } from '../api/client'
import type { LogEntry } from '../api/types'

const MAX_LOGS = 500
const MAX_RETRIES = 3

export function useTaskStream(taskId: string, enabled: boolean) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    if (!enabled || !taskId) return

    function connect() {
      if (!mountedRef.current) return

      const url = `${getWsBase()}/tasks/${taskId}/stream`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        setConnected(true)
        retryCountRef.current = 0
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; data: LogEntry[] }
          if (msg.type === 'logs' && Array.isArray(msg.data)) {
            setLogs((prev) => {
              const next = [...prev, ...msg.data]
              return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
            })
          }
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onerror = () => {
        ws.close()
      }

      ws.onclose = (event) => {
        if (!mountedRef.current) return
        setConnected(false)
        wsRef.current = null

        // Reconnect with exponential backoff on unexpected close
        if (!event.wasClean && retryCountRef.current < MAX_RETRIES) {
          const delay = 1000 * Math.pow(2, retryCountRef.current)
          retryCountRef.current += 1
          retryTimerRef.current = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      mountedRef.current = false

      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'component unmounted')
        wsRef.current = null
      }
      setConnected(false)
    }
  }, [taskId, enabled])

  function clearLogs() {
    setLogs([])
  }

  return { logs, connected, clearLogs }
}
