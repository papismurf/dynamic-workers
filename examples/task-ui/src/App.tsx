import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HomePage from './pages/HomePage'
import TaskPage from './pages/TaskPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,
    },
  },
})

export default function App() {
  // In-memory history of task IDs submitted this session.
  // Persists across route changes but resets on page reload (by design — source of
  // truth is the API, not the browser).
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([])

  function addRecentTaskIds(ids: string[]) {
    setRecentTaskIds((prev) => {
      const dedupe = new Set([...ids, ...prev])
      return Array.from(dedupe)
    })
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                recentTaskIds={recentTaskIds}
                onTasksSubmitted={addRecentTaskIds}
              />
            }
          />
          <Route path="/tasks/:taskId" element={<TaskPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
