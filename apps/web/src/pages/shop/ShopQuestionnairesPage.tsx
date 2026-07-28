// ============================================================
// ShopQuestionnairesPage — /shop-admin/questionnaires
// Manage consultation questionnaires for shop products.
// Public templates (org_id null) are supplied by PharmStation
// and are read-only; orgs can duplicate them or build their own
// with any number of questions.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useShopStore } from '@pharmstation/core'
import type { ShopQuestionnaire, ShopQuestion, ShopQuestionType } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const newQuestion = (): ShopQuestion => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  label: '',
  type: 'text',
  required: true,
})

export function ShopQuestionnairesPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    questionnaires, error,
    fetchQuestionnaires, createQuestionnaire, updateQuestionnaire, deleteQuestionnaire, clearError,
  } = useShopStore()

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ShopQuestionnaire | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Builder state
  const [fName, setFName] = useState('')
  const [fDescription, setFDescription] = useState('')
  const [fQuestions, setFQuestions] = useState<ShopQuestion[]>([newQuestion()])
  const [fActive, setFActive] = useState(true)

  const load = useCallback(() => {
    if (organisation?.id) fetchQuestionnaires(organisation.id)
  }, [organisation?.id, fetchQuestionnaires])

  useEffect(() => { load() }, [load])

  const openCreate = (from?: ShopQuestionnaire) => {
    setEditing(null)
    setFName(from ? `${from.name} (copy)` : '')
    setFDescription(from?.description || '')
    setFQuestions(from ? from.questions.map((q) => ({ ...q })) : [newQuestion()])
    setFActive(true)
    setModalError(null)
    setShowModal(true)
  }

  const openEdit = (q: ShopQuestionnaire) => {
    setEditing(q)
    setFName(q.name)
    setFDescription(q.description || '')
    setFQuestions(q.questions.map((x) => ({ ...x })))
    setFActive(q.is_active)
    setModalError(null)
    setShowModal(true)
  }

  const setQuestion = (idx: number, updates: Partial<ShopQuestion>) => {
    setFQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...updates } : q)))
  }

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    setFQuestions((qs) => {
      const next = [...qs]
      const target = idx + dir
      if (target < 0 || target >= next.length) return qs
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const handleSave = async () => {
    if (!organisation?.id || !fName.trim()) return
    const questions = fQuestions
      .map((q) => ({
        ...q,
        label: q.label.trim(),
        options: q.type === 'choice'
          ? (q.options || []).map((o) => o.trim()).filter(Boolean)
          : undefined,
      }))
      .filter((q) => q.label)
    if (!questions.length) { setModalError('Add at least one question'); return }
    if (questions.some((q) => q.type === 'choice' && (!q.options || q.options.length < 2))) {
      setModalError('Multiple-choice questions need at least two options'); return
    }
    setSaving(true); setModalError(null)
    try {
      const payload = { name: fName.trim(), description: fDescription.trim() || null, questions, is_active: fActive }
      if (editing) {
        await updateQuestionnaire(editing.id, payload)
      } else {
        await createQuestionnaire({ ...payload, org_id: organisation.id })
      }
      setShowModal(false)
    } catch (e: any) {
      setModalError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (q: ShopQuestionnaire) => {
    if (!window.confirm(`Delete "${q.name}"? Products using it will no longer require a consultation.`)) return
    try { await deleteQuestionnaire(q.id) } catch { /* store error */ }
  }

  const publicTemplates = questionnaires.filter((q) => q.org_id === null)
  const ownQuestionnaires = questionnaires.filter((q) => q.org_id !== null)

  const renderCard = (q: ShopQuestionnaire, isPublic: boolean) => {
    const isOpen = expandedId === q.id
    return (
      <div key={q.id} className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setExpandedId(isOpen ? null : q.id)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>{q.name}</strong>
              {isPublic && <span className="ps-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>Public template</span>}
              {!q.is_active && <span className="ps-badge" style={{ background: 'var(--ps-off-white)', color: 'var(--ps-slate)' }}>Inactive</span>}
            </div>
            {q.description && <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 2 }}>{q.description}</div>}
          </div>
          <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{q.questions.length} question{q.questions.length === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 'var(--ps-space-xs)' }} onClick={(e) => e.stopPropagation()}>
            {isPublic ? (
              <button className="ps-btn ps-btn-secondary" onClick={() => openCreate(q)}>Duplicate & edit</button>
            ) : (
              <>
                <button className="ps-btn ps-btn-secondary" onClick={() => openEdit(q)}>Edit</button>
                <button className="ps-btn ps-btn-secondary" onClick={() => handleDelete(q)}>🗑️</button>
              </>
            )}
          </div>
          <span>{isOpen ? '▾' : '▸'}</span>
        </div>
        {isOpen && (
          <ol style={{ margin: 'var(--ps-space-md) 0 0', paddingLeft: 24, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
            {q.questions.map((question) => (
              <li key={question.id} style={{ marginBottom: 4 }}>
                {question.label}
                <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.8 }}>
                  ({question.type === 'yesno' ? 'Yes / No' : question.type === 'choice' ? `Choice: ${(question.options || []).join(' · ')}` : 'Free text'}
                  {question.required ? ', required' : ''})
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/shop-admin" onClick={(e) => { e.preventDefault(); navigate('/shop-admin') }}>Shop</a>
          <span className="separator">/</span>
          <span>Questionnaires</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📝 Consultation Questionnaires</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => openCreate()}>+ New Questionnaire</button>
        </div>
      </div>

      <p style={{ color: 'var(--ps-slate)', marginTop: 0, marginBottom: 'var(--ps-space-lg)' }}>
        Attach a questionnaire to a product (P meds, EHC, ED treatments…) and customers must answer
        before checkout. Answers arrive with the order for pharmacist review.
      </p>

      {error && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', color: 'var(--ps-error, #dc2626)' }}>
          {error} <button className="ps-btn ps-btn-secondary" onClick={clearError} style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      )}

      <h2 style={{ fontSize: 'var(--ps-font-lg)', margin: '0 0 var(--ps-space-sm)' }}>Your questionnaires</h2>
      {ownQuestionnaires.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-xl)' }}>
          None yet — create one, or duplicate a public template below.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-xl)' }}>
          {ownQuestionnaires.map((q) => renderCard(q, false))}
        </div>
      )}

      <h2 style={{ fontSize: 'var(--ps-font-lg)', margin: '0 0 var(--ps-space-sm)' }}>Public templates</h2>
      <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 0 }}>
        Ready-made templates provided by PharmStation. Use them directly on a product, or duplicate to customise.
      </p>
      <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
        {publicTemplates.map((q) => renderCard(q, true))}
      </div>

      {/* Builder modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Questionnaire' : 'New Questionnaire'}>
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          {modalError && <div style={{ color: 'var(--ps-error, #dc2626)' }}>{modalError}</div>}
          <label>
            Name *
            <input className="ps-input" value={fName} onChange={(e) => setFName(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            Description
            <textarea className="ps-input" value={fDescription} onChange={(e) => setFDescription(e.target.value)} rows={2} style={{ width: '100%' }} />
          </label>

          <div>
            <strong style={{ display: 'block', marginBottom: 'var(--ps-space-sm)' }}>Questions</strong>
            <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
              {fQuestions.map((q, idx) => (
                <div key={q.id} className="ps-card" style={{ padding: 'var(--ps-space-sm)', display: 'grid', gap: 'var(--ps-space-xs)' }}>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', alignItems: 'center' }}>
                    <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', minWidth: 22 }}>{idx + 1}.</span>
                    <input
                      className="ps-input"
                      placeholder="Question text…"
                      value={q.label}
                      onChange={(e) => setQuestion(idx, { label: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <button className="ps-btn ps-btn-secondary" title="Move up" onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}>↑</button>
                    <button className="ps-btn ps-btn-secondary" title="Move down" onClick={() => moveQuestion(idx, 1)} disabled={idx === fQuestions.length - 1}>↓</button>
                    <button className="ps-btn ps-btn-secondary" title="Remove" onClick={() => setFQuestions((qs) => qs.filter((_, i) => i !== idx))} disabled={fQuestions.length === 1}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-md)', alignItems: 'center', paddingLeft: 26, flexWrap: 'wrap' }}>
                    <select
                      className="ps-input"
                      value={q.type}
                      onChange={(e) => setQuestion(idx, { type: e.target.value as ShopQuestionType, options: e.target.value === 'choice' ? (q.options || ['', '']) : undefined })}
                    >
                      <option value="text">Free text</option>
                      <option value="yesno">Yes / No</option>
                      <option value="choice">Multiple choice</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--ps-font-sm)' }}>
                      <input type="checkbox" checked={q.required} onChange={(e) => setQuestion(idx, { required: e.target.checked })} />
                      Required
                    </label>
                  </div>
                  {q.type === 'choice' && (
                    <div style={{ paddingLeft: 26, display: 'grid', gap: 4 }}>
                      {(q.options || []).map((opt, oIdx) => (
                        <div key={oIdx} style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="ps-input"
                            placeholder={`Option ${oIdx + 1}`}
                            value={opt}
                            onChange={(e) => setQuestion(idx, { options: (q.options || []).map((o, i) => (i === oIdx ? e.target.value : o)) })}
                            style={{ flex: 1 }}
                          />
                          <button
                            className="ps-btn ps-btn-secondary"
                            onClick={() => setQuestion(idx, { options: (q.options || []).filter((_, i) => i !== oIdx) })}
                            disabled={(q.options || []).length <= 2}
                          >✕</button>
                        </div>
                      ))}
                      <button className="ps-btn ps-btn-secondary" onClick={() => setQuestion(idx, { options: [...(q.options || []), ''] })} style={{ justifySelf: 'start' }}>
                        + Add option
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="ps-btn ps-btn-secondary" onClick={() => setFQuestions((qs) => [...qs, newQuestion()])} style={{ marginTop: 'var(--ps-space-sm)' }}>
              + Add question
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} />
            Active (available to attach to products)
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={saving || !fName.trim()} onClick={handleSave}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Questionnaire'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
