import { useQuery } from '@tanstack/react-query'
import { getUsage } from '../api/client'

export type TimeFilter = 'today' | '7days' | 'all'

function sinceMs(filter: TimeFilter): number | undefined {
  const now = Date.now()
  if (filter === 'today') return now - 24 * 60 * 60 * 1000
  if (filter === '7days') return now - 7 * 24 * 60 * 60 * 1000
  return undefined
}

export function useUsage(filter: TimeFilter = 'all') {
  return useQuery({
    queryKey: ['usage', filter],
    queryFn: () => getUsage(sinceMs(filter)),
    refetchInterval: 30_000,
  })
}
