// ============================================
// In-app replacements for window.confirm / prompt / alert.
//
//   if (!(await confirmDialog('Delete "Fridge log"? This cannot be undone.'))) return
//   const reason = await promptDialog('Reason (the locum sees this):', '')   // null if dismissed
//   alertDialog('Saved as template.')                                         // fire and forget
//
// A plain string is split into a bold title (up to the first "?" or blank line)
// and body text. Pass an options object for full control. <DialogHost /> is
// mounted once in main.tsx. See /mnt/project-files/design/design-rules.md.
// ============================================

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Info } from 'lucide-react'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive or irreversible actions. */
  danger?: boolean
}

export interface PromptOptions extends ConfirmOptions {
  label?: string
  defaultValue?: string
  placeholder?: string
  multiline?: boolean
  /** When true the confirm button stays disabled until something is typed. */
  required?: boolean
}

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'alert'; opts: ConfirmOptions; resolve: () => void }

const useDialogStore = create<{ queue: Request[]; push: (r: Request) => void; shift: () => void }>((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}))

const DANGER_WORDS = /^(delete|remove|cancel|discard|reject|reset|unlink|release|archive|withdraw|suspend|deactivate|log out|turn off|mark .* returned)/i

/** Splits "Delete X? This cannot be undone." into title + body. */
function split(message: string): { title: string; body?: string } {
  const text = message.trim()
  const para = text.indexOf('\n\n')
  const q = text.indexOf('?')
  let cut = -1
  if (q > 0 && q < 160 && (para === -1 || q < para)) cut = q + 1
  else if (para > 0 && para < 200) cut = para
  if (cut === -1 || cut >= text.length) return { title: text.length <= 120 ? text : 'Are you sure?', body: text.length <= 120 ? undefined : text }
  return { title: text.slice(0, cut).trim(), body: text.slice(cut).trim() || undefined }
}

function verbLabel(title: string): string | undefined {
  const m = title.match(/^(Delete|Remove|Discard|Reject|Reset|Unlink|Release|Archive|Withdraw|Suspend|Deactivate|Approve|Send|Upload|Publish|Restore|Re-run|Mark|Turn off|Log out|Get|Save)\b/i)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1)
  if (/^cancel\b/i.test(title)) return 'Yes, cancel'
  return undefined
}

function fromMessage(message: string | ConfirmOptions): ConfirmOptions {
  if (typeof message !== 'string') return message
  const { title, body } = split(message)
  return { title, body, danger: DANGER_WORDS.test(title), confirmLabel: verbLabel(title) }
}

export function confirmDialog(message: string | ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().push({ kind: 'confirm', opts: fromMessage(message), resolve }))
}

export function promptDialog(message: string | PromptOptions, defaultValue?: string): Promise<string | null> {
  const opts: PromptOptions =
    typeof message === 'string'
      ? (() => {
          const { title, body } = split(message)
          // A short single question reads best as the field label under a generic title.
          return body ? { title, body, defaultValue, confirmLabel: verbLabel(title) ?? 'Continue', danger: DANGER_WORDS.test(title) } : { title, defaultValue, confirmLabel: verbLabel(title) ?? 'Continue', danger: DANGER_WORDS.test(title) }
        })()
      : { ...message, defaultValue: message.defaultValue ?? defaultValue }
  return new Promise((resolve) => useDialogStore.getState().push({ kind: 'prompt', opts, resolve }))
}

export function alertDialog(message: string | ConfirmOptions): Promise<void> {
  const opts = typeof message === 'string' ? (() => { const s = split(message); return { title: s.title, body: s.body } })() : message
  return new Promise((resolve) => useDialogStore.getState().push({ kind: 'alert', opts, resolve }))
}

export function DialogHost() {
  const current = useDialogStore((s) => s.queue[0])
  const shift = useDialogStore((s) => s.shift)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!current) return
    setValue(current.kind === 'prompt' ? current.opts.defaultValue ?? '' : '')
    const t = setTimeout(() => {
      if (current.kind === 'prompt') { inputRef.current?.focus(); inputRef.current?.select() }
      else confirmRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!current) return null
  const { kind, opts } = current
  const p = kind === 'prompt' ? (opts as PromptOptions) : null

  function dismiss() {
    if (!current) return
    if (current.kind === 'confirm') current.resolve(false)
    else if (current.kind === 'prompt') current.resolve(null)
    else current.resolve()
    shift()
  }

  function accept(e?: FormEvent) {
    e?.preventDefault()
    if (!current) return
    if (current.kind === 'confirm') current.resolve(true)
    else if (current.kind === 'prompt') { if (p?.required && !value.trim()) return; current.resolve(value) }
    else current.resolve()
    shift()
  }

  const Icon = opts.danger ? AlertTriangle : Info

  return (
    <>
      <div className="modal-backdrop ps-dialog-backdrop" onClick={dismiss} />
      <div className="modal-container ps-dialog-container">
        <form
          className={`modal-dialog ps-dialog${opts.danger ? ' danger' : ''}`}
          role={kind === 'alert' ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby="ps-dialog-title"
          onSubmit={accept}
        >
          <div className="ps-dialog-main">
            <span className="ps-dialog-icon" aria-hidden="true"><Icon size={20} /></span>
            <div className="ps-dialog-text">
              <h2 id="ps-dialog-title">{opts.title}</h2>
              {opts.body && <p>{opts.body}</p>}
              {p && (
                <label className="ps-dialog-field">
                  {p.label && <span>{p.label}</span>}
                  {p.multiline ? (
                    <textarea ref={inputRef} className="ps-input" rows={3} value={value} placeholder={p.placeholder} onChange={(e) => setValue(e.target.value)} />
                  ) : (
                    <input ref={inputRef} className="ps-input" value={value} placeholder={p.placeholder} onChange={(e) => setValue(e.target.value)} />
                  )}
                </label>
              )}
            </div>
          </div>
          <div className="ps-dialog-actions">
            {kind !== 'alert' && (
              <button type="button" className="ps-btn ps-btn-secondary" onClick={dismiss}>
                {opts.cancelLabel ?? 'Go back'}
              </button>
            )}
            <button
              ref={confirmRef}
              type="submit"
              className={`ps-btn ${opts.danger ? 'ps-btn-danger' : 'ps-btn-primary'}`}
              disabled={!!p?.required && !value.trim()}
            >
              {kind === 'alert' ? 'OK' : opts.confirmLabel ?? 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
