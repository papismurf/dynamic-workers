import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { submitTasks } from '../api/client'
import type { AgentType } from '../api/types'

// ---------------------------------------------------------------------------
// Agent type metadata
// ---------------------------------------------------------------------------

const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  codegen: 'Generate new code from a natural language specification',
  test: 'Write unit and integration tests for existing code',
  review: 'Review code for bugs, security issues, and improvements',
  refactor: 'Restructure code for clarity and performance without changing behavior',
  debug: 'Diagnose and fix failing tests or runtime errors',
  dependency: 'Update, audit, or resolve project dependencies',
}

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const fileEntrySchema = z.object({
  path: z.string().min(1, 'File path is required'),
  content: z.string(),
})

const taskFormSchema = z.object({
  description: z.string().min(10, 'Description must be at least 10 characters'),
  agentType: z.enum(['codegen', 'test', 'review', 'refactor', 'debug', 'dependency']),
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo name is required'),
  branch: z.string().min(1, 'Working branch is required'),
  baseBranch: z.string().min(1, 'Base branch is required'),
  files: z.array(fileEntrySchema),
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().optional(),
  maxTokens: z.coerce.number().int().positive().optional().or(z.literal('')),
  temperature: z.coerce.number().min(0).max(1).optional(),
  maxRetries: z.coerce.number().int().min(0).optional().or(z.literal('')),
})

type FormValues = z.infer<typeof taskFormSchema>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelClass() {
  return 'block text-sm font-medium text-slate-700 mb-1'
}

function inputClass(hasError?: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
    hasError ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
  }`
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1 text-xs text-red-600" role="alert">
      {message}
    </p>
  )
}

// ---------------------------------------------------------------------------
// TaskForm
// ---------------------------------------------------------------------------

interface TaskFormProps {
  onTasksSubmitted?: (taskIds: string[]) => void
}

export default function TaskForm({ onTasksSubmitted }: TaskFormProps) {
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      agentType: 'codegen',
      branch: `agent/task-${Date.now()}`,
      baseBranch: 'main',
      files: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'files' })
  const selectedAgentType = watch('agentType')

  async function onSubmit(values: FormValues) {
    setSubmitError(null)

    const config: Record<string, unknown> = {}
    if (values.provider) config['provider'] = values.provider
    if (values.model) config['model'] = values.model
    if (values.maxTokens && values.maxTokens !== '') config['maxTokens'] = Number(values.maxTokens)
    if (values.temperature !== undefined) config['temperature'] = values.temperature
    if (values.maxRetries && values.maxRetries !== '') config['maxRetries'] = Number(values.maxRetries)

    try {
      const result = await submitTasks({
        tasks: [
          {
            description: values.description,
            agentType: values.agentType,
            repo: {
              owner: values.owner,
              repo: values.repo,
              branch: values.branch,
              baseBranch: values.baseBranch,
              files: Object.fromEntries(
                values.files.map((f) => [f.path, f.content]),
              ),
            },
            ...(Object.keys(config).length > 0 ? { config } : {}),
          },
        ],
      })

      onTasksSubmitted?.(result.taskIds)

      if (result.taskIds[0]) {
        navigate(`/tasks/${result.taskIds[0]}`)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit task')
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
      aria-label="Submit agent task"
    >
      <div className="space-y-5">
        {/* Description */}
        <div>
          <label htmlFor="description" className={labelClass()}>
            Description <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="description"
            rows={3}
            placeholder="Add input validation to the user registration endpoint"
            {...register('description')}
            className={inputClass(!!errors.description) + ' resize-none'}
          />
          <FieldError message={errors.description?.message} />
        </div>

        {/* Agent Type */}
        <div>
          <label htmlFor="agentType" className={labelClass()}>
            Agent Type <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <select
            id="agentType"
            {...register('agentType')}
            className={inputClass(!!errors.agentType)}
          >
            {(Object.entries(AGENT_DESCRIPTIONS) as [AgentType, string][]).map(([type]) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {AGENT_DESCRIPTIONS[selectedAgentType]}
          </p>
          <FieldError message={errors.agentType?.message} />
        </div>

        {/* Repo section */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700 mb-2">Repository</legend>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="owner" className={labelClass()}>
                Owner <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="owner"
                type="text"
                placeholder="myorg"
                {...register('owner')}
                className={inputClass(!!errors.owner)}
              />
              <FieldError message={errors.owner?.message} />
            </div>
            <div>
              <label htmlFor="repo" className={labelClass()}>
                Repository <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="repo"
                type="text"
                placeholder="my-api"
                {...register('repo')}
                className={inputClass(!!errors.repo)}
              />
              <FieldError message={errors.repo?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="branch" className={labelClass()}>
                Working Branch <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="branch"
                type="text"
                {...register('branch')}
                className={inputClass(!!errors.branch)}
              />
              <FieldError message={errors.branch?.message} />
            </div>
            <div>
              <label htmlFor="baseBranch" className={labelClass()}>
                Base Branch <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="baseBranch"
                type="text"
                {...register('baseBranch')}
                className={inputClass(!!errors.baseBranch)}
              />
              <FieldError message={errors.baseBranch?.message} />
            </div>
          </div>
        </fieldset>

        {/* Files */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Files</span>
            <button
              type="button"
              onClick={() => append({ path: '', content: '' })}
              aria-label="Add a file to the task context"
              className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              + Add File
            </button>
          </div>

          {fields.length === 0 && (
            <p className="text-xs text-slate-400 italic py-2">
              No files added. The agent will work without file context.
            </p>
          )}

          <div className="space-y-3">
            {fields.map((field, idx) => (
              <div
                key={field.id}
                className="rounded-lg border border-slate-200 p-3 bg-slate-50 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label
                      htmlFor={`files.${idx}.path`}
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      File path
                    </label>
                    <input
                      id={`files.${idx}.path`}
                      type="text"
                      placeholder="src/routes/register.ts"
                      {...register(`files.${idx}.path`)}
                      className={inputClass(!!errors.files?.[idx]?.path) + ' font-mono text-xs'}
                    />
                    <FieldError message={errors.files?.[idx]?.path?.message} />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    aria-label={`Remove file ${idx + 1}`}
                    className="mt-5 shrink-0 text-slate-400 hover:text-red-500 transition-colors text-sm"
                  >
                    ✕
                  </button>
                </div>
                <div>
                  <label
                    htmlFor={`files.${idx}.content`}
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Content
                  </label>
                  <textarea
                    id={`files.${idx}.content`}
                    rows={4}
                    placeholder="// paste file contents here"
                    {...register(`files.${idx}.content`)}
                    className={inputClass() + ' font-mono text-xs resize-y'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced Config */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            aria-controls="advanced-config"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            Advanced Config
            <span aria-hidden="true" className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>

          {advancedOpen && (
            <div id="advanced-config" className="p-4 space-y-4 bg-white">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="provider" className={labelClass()}>
                    Provider
                  </label>
                  <select
                    id="provider"
                    {...register('provider')}
                    className={inputClass()}
                  >
                    <option value="">Default</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="model" className={labelClass()}>
                    Model
                  </label>
                  <input
                    id="model"
                    type="text"
                    placeholder="claude-sonnet-4-20250514"
                    {...register('model')}
                    className={inputClass()}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="maxTokens" className={labelClass()}>
                    Max Tokens
                  </label>
                  <input
                    id="maxTokens"
                    type="number"
                    min={1}
                    placeholder="4096"
                    {...register('maxTokens')}
                    className={inputClass()}
                  />
                </div>
                <div>
                  <label htmlFor="maxRetries" className={labelClass()}>
                    Max Retries
                  </label>
                  <input
                    id="maxRetries"
                    type="number"
                    min={0}
                    placeholder="3"
                    {...register('maxRetries')}
                    className={inputClass()}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="temperature" className={labelClass()}>
                  Temperature: {watch('temperature') ?? 0}
                </label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  {...register('temperature')}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                  <span>Precise (0)</span>
                  <span>Creative (1)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* API error */}
        {submitError && (
          <div
            className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <strong>Error:</strong> {submitError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          aria-label="Submit task to the orchestrator"
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Submitting…' : 'Submit Task'}
        </button>
      </div>
    </form>
  )
}
