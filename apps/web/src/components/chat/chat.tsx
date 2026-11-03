import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

// Shared building blocks for the chat screens (Pharmacy Network threads, the patient text inbox
// and Genie). The message list is its own scroll area, so new messages never scroll the page.

const NEAR_BOTTOM_PX = 120

/**
 * Keeps a scrollable message list pinned to the newest message.
 * - On first render and when the conversation changes (`resetKey`) it jumps straight to the bottom.
 * - When new content arrives it follows only if the reader was already near the bottom,
 *   so scrolling up to read history isn't interrupted. Otherwise `showJump` turns on.
 */
export function useStickToBottom<T extends HTMLElement>(contentKey: unknown, resetKey?: unknown) {
  const ref = useRef<T>(null)
  const nearBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = ref.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    nearBottom.current = true
    setShowJump(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    nearBottom.current = near
    if (near) setShowJump(false)
  }, [])

  useLayoutEffect(() => {
    nearBottom.current = true
    scrollToBottom()
  }, [resetKey, scrollToBottom])

  useLayoutEffect(() => {
    if (nearBottom.current) scrollToBottom()
    else setShowJump(true)
  }, [contentKey, scrollToBottom])

  return { ref, onScroll, showJump, scrollToBottom }
}

export function JumpToLatest({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null
  return (
    <button type="button" className="chat-jump" onClick={onClick}>
      ↓ New messages
    </button>
  )
}

function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function formatDayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Today'
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday'
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

export function formatChatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Renders items with a "Today" / "Yesterday" / date divider wherever the day changes. */
export function WithDayDividers<T>({ items, getTime, render }: {
  items: T[]
  getTime: (item: T) => string
  render: (item: T, index: number) => ReactNode
}) {
  let last = ''
  return (
    <>
      {items.map((item, index) => {
        const time = getTime(item)
        const key = dayKey(time)
        const divider = key !== last
        last = key
        return (
          <Fragment key={index}>
            {divider && <div className="chat-day" role="separator"><span>{formatDayLabel(time)}</span></div>}
            {render(item, index)}
          </Fragment>
        )
      })}
    </>
  )
}

/** Grows with its content up to a max height, like a messaging app's text box. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 180) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [ref, value, maxPx])
}

export function ChatComposer({
  value, onChange, onSend, disabled, sending, placeholder, sendLabel = 'Send', maxLength, before, after, autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  sending?: boolean
  placeholder?: string
  sendLabel?: string
  maxLength?: number
  before?: ReactNode
  after?: ReactNode
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  const canSend = !disabled && !sending && value.trim().length > 0

  return (
    <div className="chat-composer">
      {before}
      <div className="chat-composer-row">
        <textarea
          ref={ref}
          className="chat-composer-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={placeholder ?? 'Message'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canSend) onSend()
            }
          }}
        />
        <button type="button" className="chat-send" onClick={onSend} disabled={!canSend} aria-label={sendLabel}>
          {sending ? <span className="chat-send-spinner" aria-hidden="true" /> : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          )}
        </button>
      </div>
      <div className="chat-composer-foot">
        <span>Enter to send · Shift + Enter for a new line</span>
        {after}
      </div>
    </div>
  )
}
