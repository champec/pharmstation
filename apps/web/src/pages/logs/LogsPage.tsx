import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogEntry, LogSubscription } from '@pharmstation/types'
import { Drawer } from '../../components/Drawer'
import { LogEntryForm } from './LogEntryForm'
import { NotebookPen, Trophy } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { Celebration, CategoryIcon, ProgressRing, StreakBadge, useCelebration } from './LogBits'
import {
  addDays,
  categoryOf,
  cheer,
  computeStreak,
  formatDay,
  formatTime,
  isRequiredOn,
  isScheduled,
  missedDays,
  relativeDay,
  scheduleLabel,
  ukDate,
  HANDOVER_TEMPLATE_ID,
} from './logUtils'

const WINDOW_DAYS = 35

interface CardState {
  sub: LogSubscription
  todayEntry: LogEntry | null
  lastEntry: LogEntry | null
  dueToday: boolean
  streak: number
  missedThisWeek: number
}

export function LogsPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    subscriptions, orgEntries, activeFields, activeTemplate, loading, error,
    fetchSubscriptions, fetchOrgEntries, fetchTemplateDetail, saveEntry, subscribeToLibrary, clearError,
  } = useLogStore()
  const { celebration, celebrate, dismiss } = useCelebration()

  const today = ukDate()
  const windowStart = addDays(today, -(WINDOW_DAYS - 1))

  const [quickSub, setQuickSub] = useState<LogSubscription | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!organisation?.id) return
    fetchSubscriptions(organisation.id)
    fetchOrgEntries(organisation.id, { start: windowStart, end: today })
  }, [organisation?.id, fetchSubscriptions, fetchOrgEntries, windowStart, today])

  const handoverSub = subscriptions.find((s) => s.template_id === HANDOVER_TEMPLATE_ID) ?? null
  const handoverNotes = useMemo(
    () =>
      handoverSub
        ? orgEntries
            .filter((e) => e.subscription_id === handoverSub.id && !e.voided_at && e.entry_date >= addDays(today, -6))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 3)
        : [],
    [handoverSub, orgEntries, today],
  )
  const [openingHandover, setOpeningHandover] = useState(false)
  const writeHandover = async () => {
    if (!organisation?.id) return
    if (handoverSub) return openQuick(handoverSub)
    setOpeningHandover(true)
    try {
      const sub = await subscribeToLibrary(organisation.id, HANDOVER_TEMPLATE_ID)
      openQuick(sub)
    } catch {
      // error shown by the store
    } finally {
      setOpeningHandover(false)
    }
  }

  const cards: CardState[] = useMemo(() => {
    return subscriptions.filter((sub) => sub.template_id !== HANDOVER_TEMPLATE_ID).map((sub) => {
      const mine = orgEntries.filter((e) => e.subscription_id === sub.id)
      const dates = new Set(mine.map((e) => e.entry_date))
      const todayEntry = mine.find((e) => e.entry_date === today) ?? null
      const lastEntry = [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
      return {
        sub,
        todayEntry,
        lastEntry,
        dueToday: isRequiredOn(sub.template, today),
        streak: computeStreak(sub.template, dates, today, WINDOW_DAYS),
        missedThisWeek: missedDays(
          sub.template, dates, addDays(today, -7), today,
          [sub.subscribed_at ? ukDate(new Date(sub.subscribed_at)) : null, ...[...dates].sort()].filter((d): d is string => !!d).sort()[0] ?? null,
        ).length,
      }
    })
  }, [subscriptions, orgEntries, today])

  const due = cards.filter((c) => c.dueToday)
  const doneCount = due.filter((c) => c.todayEntry).length
  const left = due.filter((c) => !c.todayEntry)
  const allDone = due.length > 0 && left.length === 0

  const openQuick = (sub: LogSubscription) => {
    setSaveError(null)
    fetchTemplateDetail(sub.template_id)
    setQuickSub(sub)
  }

  const handleQuickSave = async (data: Record<string, unknown>) => {
    if (!quickSub) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveEntry({ subscriptionId: quickSub.id, entryDate: today, data })
      const remaining = left.filter((c) => c.sub.id !== quickSub.id).length
      const title = quickSub.custom_title || quickSub.template?.title || 'Log'
      setQuickSub(null)
      if (isScheduled(quickSub.template) && remaining === 0 && due.length > 0) {
        celebrate('Every log done for today!', 'Lovely work. See you tomorrow.', Trophy)
      } else {
        celebrate(cheer(), remaining > 0 ? `${title} saved. ${remaining} left today.` : `${title} saved.`, categoryOf(quickSub.template).icon)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const quickFieldsReady = quickSub && activeTemplate?.id === quickSub.template_id

  return (
    <div className="logs-page">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Logs' }]}
        title="Logs"
        subtitle={formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={<>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs/library')}>Library</button>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>+ New log</button>
        </>}
      />

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Today */}
      {subscriptions.length > 0 && (
        <section className={`logs-today${allDone ? ' is-done' : ''}`} aria-label="Today">
          <ProgressRing done={doneCount} total={due.length} />
          <div className="logs-today-body">
            {due.length === 0 ? (
              <>
                <h2>Nothing due today</h2>
                <p className="log-muted">Your as-needed logs are below whenever you need them.</p>
              </>
            ) : allDone ? (
              <>
                <h2>All done for today</h2>
                <p className="log-muted">Every log that's due today has been filled in.</p>
              </>
            ) : (
              <>
                <h2>{left.length} {left.length === 1 ? 'log' : 'logs'} left today</h2>
                <div className="logs-today-left">
                  {left.map((c) => {
                    const cat = categoryOf(c.sub.template)
                    return (
                      <button key={c.sub.id} className="logs-today-chip" style={{ ['--cat' as string]: cat.color }} onClick={() => openQuick(c.sub)}>
                        <cat.icon size={16} strokeWidth={1.75} aria-hidden="true" /> {c.sub.custom_title || c.sub.template?.title}
                        <span className="logs-today-chip-go">Log now →</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Shift handover */}
      {subscriptions.length > 0 && (
        <section className="ps-card log-handover" aria-label="Shift handover">
          <div className="log-handover-head">
            <div>
              <h2>Shift handover</h2>
              <p className="log-muted">Leave notes for whoever is on next. They also show in the PharmStation app.</p>
            </div>
            <div className="logs-header-actions">
              {handoverSub && <button className="ps-btn ps-btn-ghost" onClick={() => navigate(`/logs/${handoverSub.id}`)}>All notes</button>}
              <button className="ps-btn ps-btn-secondary" onClick={writeHandover} disabled={openingHandover}>
                {openingHandover ? 'Opening…' : '+ Write a handover note'}
              </button>
            </div>
          </div>
          {handoverNotes.length === 0 ? (
            <p className="log-muted">No handover notes in the last week.</p>
          ) : (
            <ul className="log-handover-list">
              {handoverNotes.map((n) => {
                const d = n.data as Record<string, unknown>
                const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
                return (
                  <li key={n.id} className={d.urgent === true ? 'is-urgent' : ''}>
                    <div className="log-handover-meta">
                      {d.urgent === true && <span className="ps-badge ps-badge-red">Urgent</span>}
                      <span>{relativeDay(n.entry_date, today)} · {formatTime(n.created_at)} · {str(d.handed_over_by) ?? n.entered_by_profile?.full_name ?? 'Not recorded'}{str(d.handed_to) ? ` → ${str(d.handed_to)}` : ''}</span>
                    </div>
                    {str(d.summary) && <p>{str(d.summary)}</p>}
                    {str(d.outstanding) && <p className="log-handover-todo"><strong>Still to do:</strong> {str(d.outstanding)}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {loading && subscriptions.length === 0 && (
        <div className="logs-grid">
          {[1, 2, 3].map((i) => <div key={i} className="log-card log-card-skeleton" />)}
        </div>
      )}

      {!loading && subscriptions.length === 0 && (
        <EmptyState
          icon={NotebookPen}
          title="No logs yet"
          actions={<>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs/new')}>+ Build your own</button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/library')}>Browse the library</button>
          </>}
        >
          Add a fridge temperature log, cleaning rota or visitor book from the library in one click, or build your own.
        </EmptyState>
      )}

      {cards.length > 0 && (
        <div className="logs-grid">
          {cards.map(({ sub, todayEntry, lastEntry, dueToday, streak, missedThisWeek }) => {
            const template = sub.template
            const cat = categoryOf(template)
            const scheduled = isScheduled(template)
            return (
              <article
                key={sub.id}
                className={`log-card${dueToday && !todayEntry ? ' is-due' : ''}${todayEntry && scheduled ? ' is-done' : ''}`}
                style={{ ['--cat' as string]: cat.color, ['--cat-tint' as string]: cat.tint }}
              >
                <button className="log-card-main" onClick={() => navigate(`/logs/${sub.id}`)}>
                  <div className="log-card-top">
                    <CategoryIcon icon={cat.icon} />
                    <div className="log-card-titles">
                      <h3>{sub.custom_title || template?.title || 'Untitled log'}</h3>
                      <span className="log-muted">{scheduleLabel(template?.schedule_type, template?.required_days)}</span>
                    </div>
                  </div>
                  <div className="log-card-status">
                    {scheduled ? (
                      todayEntry ? (
                        <span className="log-status ok">✓ Done at {formatTime(todayEntry.created_at)}{todayEntry.entered_by_profile?.full_name ? ` by ${todayEntry.entered_by_profile.full_name.split(' ')[0]}` : ''}</span>
                      ) : dueToday ? (
                        <span className="log-status due">● Due today</span>
                      ) : (
                        <span className="log-status off">Not needed today</span>
                      )
                    ) : lastEntry ? (
                      <span className="log-status off">Last entry {relativeDay(lastEntry.entry_date, today).toLowerCase()}</span>
                    ) : (
                      <span className="log-status off">No entries yet</span>
                    )}
                    <StreakBadge streak={streak} />
                    {missedThisWeek > 0 && (
                      <span className="log-missed">{missedThisWeek} missed this week</span>
                    )}
                  </div>
                </button>
                <div className="log-card-actions">
                  {scheduled && todayEntry ? (
                    <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate(`/logs/${sub.id}`)}>View log</button>
                  ) : (
                    <button className="ps-btn ps-btn-primary ps-btn-sm log-cta" onClick={() => openQuick(sub)}>
                      {cat.cta}
                    </button>
                  )}
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate(`/logs/${sub.id}/settings`)} aria-label="Log settings">⚙️</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Drawer
        isOpen={!!quickSub}
        onClose={() => setQuickSub(null)}
        title={quickSub?.custom_title || quickSub?.template?.title || 'Log'}
        width="520px"
      >
        {quickSub && !quickFieldsReady && <p className="log-muted">Loading…</p>}
        {quickSub && quickFieldsReady && (
          <LogEntryForm
            key={quickSub.id}
            fields={activeFields}
            date={isScheduled(quickSub.template) ? today : undefined}
            userName={activeUser?.full_name}
            saving={saving}
            error={saveError}
            onSubmit={(data) => handleQuickSave(data)}
            onCancel={() => setQuickSub(null)}
          />
        )}
      </Drawer>

      <Celebration state={celebration} onDismiss={dismiss} />
    </div>
  )
}
