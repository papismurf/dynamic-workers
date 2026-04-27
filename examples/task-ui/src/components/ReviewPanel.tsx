import { useEffect, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import diffLang from 'highlight.js/lib/languages/diff'
import { submitReview } from '../api/client'
import type { TaskState } from '../api/types'

hljs.registerLanguage('diff', diffLang)

type Decision = 'approve' | 'reject' | 'revise'

interface ReviewPanelProps {
  task: TaskState
  onReviewed: () => void
}

function DiffViewer({ diff }: { diff: string }) {
  const codeRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (codeRef.current) {
      delete codeRef.current.dataset['highlighted']
      hljs.highlightElement(codeRef.current)
    }
  }, [diff])

  return (
    <div className="rounded-lg overflow-auto max-h-64 text-xs border border-slate-700">
      <pre className="p-3 m-0">
        <code ref={codeRef} className="language-diff">
          {diff}
        </code>
      </pre>
    </div>
  )
}

export default function ReviewPanel({ task, onReviewed }: ReviewPanelProps) {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const results = Object.values(task.results ?? {})
  const allFiles = results.flatMap((r) => Object.keys(r.output.files ?? {}))
  const reviewComments = results.flatMap((r) => r.output.reviewComments ?? [])
  const diff = results.find((r) => r.output.diff)?.output.diff

  async function handleSubmit() {
    if (!decision) return
    if ((decision === 'reject' || decision === 'revise') && !feedback.trim()) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      await submitReview(task.id, {
        taskId: task.id,
        decision,
        feedback: feedback.trim() || undefined,
      })
      setSuccess(true)
      onReviewed()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Review submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (task.status !== 'review') return null

  if (success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-700 font-medium">
          {decision === 'approve'
            ? 'Task approved. The orchestrator will create a pull request.'
            : decision === 'reject'
            ? 'Task rejected.'
            : 'Revision requested. The agent will retry with your feedback.'}
        </p>
        {task.reviewUrl && (
          <a
            href={task.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-sm text-green-700 font-medium hover:underline"
            aria-label="View pull request on GitHub"
          >
            View pull request &rarr;
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-yellow-600 text-lg" aria-hidden="true">!</span>
        <h2 className="text-sm font-semibold text-yellow-800">Human Review Required</h2>
      </div>

      {/* Files changed */}
      {allFiles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1.5">Files changed ({allFiles.length})</p>
          <ul className="space-y-0.5">
            {allFiles.map((f) => (
              <li key={f} className="font-mono text-xs text-slate-700 bg-white rounded px-2 py-1 border border-slate-200">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Review comments */}
      {reviewComments.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1.5">
            Review comments ({reviewComments.length})
          </p>
          <ul className="space-y-1.5">
            {reviewComments.map((c, idx) => (
              <li
                key={idx}
                className={`text-xs rounded-lg px-3 py-2 border ${
                  c.severity === 'error'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : c.severity === 'warning'
                    ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <span className="font-mono">{c.file}:{c.line}</span>
                {' — '}
                {c.message}
                {c.suggestion && (
                  <p className="mt-1 italic opacity-80">Suggestion: {c.suggestion}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Diff viewer */}
      {diff && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1.5">Diff</p>
          <DiffViewer diff={diff} />
        </div>
      )}

      {/* Decision buttons */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Decision</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDecision('approve')}
            aria-pressed={decision === 'approve'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              decision === 'approve'
                ? 'bg-green-600 border-green-600 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:border-green-500 hover:text-green-700'
            }`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDecision('revise')}
            aria-pressed={decision === 'revise'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              decision === 'revise'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:border-blue-500 hover:text-blue-700'
            }`}
          >
            Request Revision
          </button>
          <button
            type="button"
            onClick={() => setDecision('reject')}
            aria-pressed={decision === 'reject'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              decision === 'reject'
                ? 'bg-red-600 border-red-600 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:border-red-500 hover:text-red-700'
            }`}
          >
            Reject
          </button>
        </div>
      </div>

      {/* Feedback textarea (required for reject/revise) */}
      {(decision === 'reject' || decision === 'revise') && (
        <div>
          <label
            htmlFor="review-feedback"
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            Feedback {decision === 'revise' ? '(instructions for the agent)' : '(reason for rejection)'}
            <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
          </label>
          <textarea
            id="review-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder={
              decision === 'revise'
                ? 'Describe what needs to change…'
                : 'Why is this being rejected?'
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      )}

      {/* Error */}
      {submitError && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2" role="alert">
          {submitError}
        </p>
      )}

      {/* Submit */}
      {decision && (
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={
            submitting ||
            ((decision === 'reject' || decision === 'revise') && !feedback.trim())
          }
          aria-label={`Confirm ${decision} decision`}
          className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting…' : `Confirm ${decision}`}
        </button>
      )}
    </div>
  )
}
