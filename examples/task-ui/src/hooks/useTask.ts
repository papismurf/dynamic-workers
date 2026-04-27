import { useQuery } from '@tanstack/react-query'
import { getTask } from '../api/client'
import type { TaskStatus } from '../api/types'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'assigned', 'running', 'review'])

export function useTask(taskId: string) {
  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.task.status
      if (!status) return 2000
      return ACTIVE_STATUSES.has(status) ? 2000 : false
    },
    enabled: taskId.length > 0,
  })

  return {
    task: query.data?.task,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
