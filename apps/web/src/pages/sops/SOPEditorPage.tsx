import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore, canManageSOPs } from '@pharmstation/core'
import type { SOPNode } from '@pharmstation/types'
import { RichTextEditor } from '../../components/sop/RichTextEditor'
import { Modal } from '../../components/Modal'
import { SOPReviewBar } from '../../components/sop/SOPReviewBar'
import { FileText, Folder, Pencil, X } from 'lucide-react'

// ── Tree node (recursive) ─────────────────────────────────────
function TreeNodeItem({
  node,
  depth,
  selectedId,
  onSelect,
  onAddChild,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  node: SOPNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  onAddChild: (parentId: string) => void
  onRename: (node: SOPNode) => void
  onDelete: (node: SOPNode) => void
  onMoveUp: (node: SOPNode) => void
  onMoveDown: (node: SOPNode) => void
}) {
  const [hover, setHover] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const hasChildren = (node.children?.length ?? 0) > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: depth * 16 + 4,
          paddingRight: 4,
          paddingTop: 4,
          paddingBottom: 4,
          borderRadius: 6,
          background: isSelected ? 'var(--ps-accent-bg)' : hover ? 'var(--ps-surface-hover)' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => onSelect(node.id)}
      >
        {/* Expand toggle */}
        <span
          style={{ width: 16, fontSize: 11, color: 'var(--ps-text-muted)', flexShrink: 0, userSelect: 'none' }}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>

        {/* Content type icon */}
        <span style={{ fontSize: 13 }}>
          {node.content_type === 'pdf' ? <FileText size={14} strokeWidth={1.75} aria-hidden="true" /> : node.content_type === 'none' ? <Folder size={14} strokeWidth={1.75} aria-hidden="true" /> : <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />}
        </span>

        {/* Title */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: isSelected ? 'var(--ps-accent)' : 'var(--ps-text)',
            fontWeight: isSelected ? 600 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.title}
        </span>

        {/* Actions (show on hover) */}
        {hover && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            <button
              title="Move up"
              onClick={() => onMoveUp(node)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 2, color: 'var(--ps-text-muted)' }}
            >▲</button>
            <button
              title="Move down"
              onClick={() => onMoveDown(node)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 2, color: 'var(--ps-text-muted)' }}
            >▼</button>
            <button
              title="Add child section"
              onClick={() => onAddChild(node.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, color: 'var(--ps-accent)' }}
            >+</button>
            <button
              title="Rename"
              onClick={() => onRename(node)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 2, color: 'var(--ps-text-muted)' }}
             aria-label="Rename"><Pencil size={12} strokeWidth={1.75} aria-hidden="true" /></button>
            <button
              title="Delete"
              onClick={() => onDelete(node)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 2, color: 'var(--ps-danger)' }}
             aria-label="Delete"><X size={12} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main SOP Editor Page ──────────────────────────────────────
export function SOPEditorPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser, membership } = useAuthStore()
  const isManager = canManageSOPs(membership)

  const {
    activeDocument,
    activeNodes,
    activeNodeTree,
    selectedNodeId,
    loading,
    saving,
    error,
    fetchDocument,
    updateDocument,
    publishDocument,
    archiveDocument,
    createNode,
    updateNode,
    deleteNode,
    moveNode,
    uploadNodePDF,
    getNodePDFUrl,
    setSelectedNode,
    clearError,
  } = useSOPStore()

  // Local state
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editingMeta, setEditingMeta] = useState(false)
  const [nodeContent, setNodeContent] = useState('')
  const [nodeHasUnsaved, setNodeHasUnsaved] = useState(false)
  const [addingNode, setAddingNode] = useState<{ parentId: string | null } | null>(null)
  const [newNodeTitle, setNewNodeTitle] = useState('')
  const [renameNode, setRenameNode] = useState<SOPNode | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Staff who can't edit SOPs get the read view instead of an editor whose saves fail.
  useEffect(() => {
    if (membership && !isManager && docId) navigate(`/sops/${docId}/read`, { replace: true })
  }, [membership, isManager, docId, navigate])

  // Load document
  useEffect(() => {
    if (docId) fetchDocument(docId)
  }, [docId, fetchDocument])

  // Sync meta fields
  useEffect(() => {
    if (activeDocument) {
      setEditTitle(activeDocument.title)
      setEditDesc(activeDocument.description ?? '')
    }
  }, [activeDocument])

  // Sync node content when selection changes
  const selectedNode = activeNodes.find((n) => n.id === selectedNodeId) ?? null

  useEffect(() => {
    setNodeContent(selectedNode?.rich_content ?? '')
    setNodeHasUnsaved(false)
    setPdfUrl(null)

    if (selectedNode?.content_type === 'pdf' && selectedNode?.pdf_storage_path) {
      setPdfLoading(true)
      getNodePDFUrl(selectedNode.pdf_storage_path).then((url) => {
        setPdfUrl(url)
        setPdfLoading(false)
      })
    }
  }, [selectedNodeId, selectedNode?.id])

  // Auto-save node content (debounced). Edits are held in pendingSave until
  // they reach the database; switching section or publishing saves them first.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ nodeId: string; html: string } | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle')

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
    }
    const pending = pendingSave.current
    if (!pending) return true
    setSaveState('saving')
    const ok = await updateNode(pending.nodeId, { rich_content: pending.html })
    if (pendingSave.current === pending) pendingSave.current = null
    if (!ok) {
      if (!pendingSave.current) pendingSave.current = pending // keep it to retry
      setSaveState('error')
      return false
    }
    setSaveState(pendingSave.current ? 'unsaved' : 'saved')
    setNodeHasUnsaved(!!pendingSave.current)
    return true
  }, [updateNode])

  const handleContentChange = useCallback(
    (html: string) => {
      if (!selectedNodeId) return
      // Ignore "changes" that leave the section as it is stored.
      const stored = activeNodes.find((n) => n.id === selectedNodeId)?.rich_content ?? ''
      if (!pendingSave.current && (html === stored || (html === '<p></p>' && !stored))) return
      setNodeContent(html)
      setNodeHasUnsaved(true)
      setSaveState('unsaved')
      pendingSave.current = { nodeId: selectedNodeId, html }
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(() => { void flushSave() }, 1000)
    },
    [selectedNodeId, flushSave, activeNodes]
  )

  const selectNode = useCallback(
    async (id: string | null) => {
      if (id === selectedNodeId) return
      await flushSave()
      setSaveState('idle')
      setSelectedNode(id)
    },
    [selectedNodeId, flushSave, setSelectedNode]
  )

  // Warn before leaving with edits that haven't saved, and save on the way out.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingSave.current) {
        void flushSave()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      void flushSave()
    }
  }, [flushSave])

  const saveMeta = async () => {
    if (!docId) return
    await updateDocument(docId, {
      title: editTitle.trim(),
      description: editDesc.trim(),
      updated_by: activeUser?.id,
    })
    setEditingMeta(false)
  }

  const handleAddNode = async () => {
    if (!docId || !newNodeTitle.trim()) return
    const parentId = addingNode?.parentId ?? null
    const siblings = activeNodes.filter((n) => n.parent_id === parentId)
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((n) => n.sort_order)) : -1
    await createNode({
      document_id: docId,
      parent_id: parentId,
      title: newNodeTitle.trim(),
      sort_order: maxOrder + 1,
    })
    setAddingNode(null)
    setNewNodeTitle('')
  }

  const handleRenameConfirm = async () => {
    if (!renameNode || !renameTitle.trim()) return
    await updateNode(renameNode.id, { title: renameTitle.trim() })
    setRenameNode(null)
    setRenameTitle('')
  }

  const handleDeleteNode = async (node: SOPNode) => {
    const childCount = activeNodes.filter((n) => n.parent_id === node.id).length
    const msg = childCount > 0
      ? `Delete "${node.title}" and its ${childCount} child section(s)?`
      : `Delete "${node.title}"?`
    if (!confirm(msg)) return
    await deleteNode(node.id)
  }

  const handleMoveNode = async (node: SOPNode, dir: 'up' | 'down') => {
    const siblings = activeNodes
      .filter((n) => n.parent_id === node.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = siblings.findIndex((n) => n.id === node.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const swap = siblings[swapIdx]
    await Promise.all([
      moveNode(node.id, node.parent_id, swap.sort_order),
      moveNode(swap.id, swap.parent_id, node.sort_order),
    ])
  }

  const handleContentTypeChange = async (type: 'rich_text' | 'pdf' | 'none') => {
    if (!selectedNodeId) return
    await updateNode(selectedNodeId, { content_type: type })
  }

  const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again
    if (!file || !selectedNodeId || !docId) return
    try {
      setPdfLoading(true)
      const path = await uploadNodePDF(selectedNodeId, docId, file)
      setPdfUrl(await getNodePDFUrl(path))
    } catch (e: any) {
      alert(`Upload failed: ${e.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const neverPublished = !activeDocument?.published_at
  const hasChanges = !!activeDocument?.has_unpublished_changes

  const handlePublish = async () => {
    if (!docId || !activeDocument) return
    let msg: string
    if (activeDocument.status === 'archived' && !hasChanges) {
      msg = `Restore v${activeDocument.version} so assigned staff can read and sign it again? Existing sign-offs still count.`
    } else if (neverPublished) {
      msg = 'Publish this SOP? Assigned staff will be able to read and sign it.'
    } else {
      msg = 'Publish a new version? Assigned staff will be asked to read and sign it again. Their sign-offs for the old version are kept.'
    }
    if (!confirm(msg)) return
    if (!(await flushSave())) {
      alert('Your latest changes could not be saved, so the SOP was not published. Check your connection and try again.')
      return
    }
    await publishDocument(docId)
  }

  const handleArchive = async () => {
    if (!docId) return
    if (!confirm('Archive this SOP? Staff will no longer see it. Its sign-off history is kept and you can restore it later.')) return
    await archiveDocument(docId)
  }

  if (loading && !activeDocument) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--ps-text-muted)' }}>Loading…</div>
  }

  const doc = activeDocument

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Page header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/sops" onClick={(e) => { e.preventDefault(); navigate('/sops') }}>SOPs</a>
          <span className="separator">/</span>
          <span>{doc?.title ?? 'Editor'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0 }}>
              {editingMeta ? (
                <input
                  className="ps-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ fontSize: 'inherit', fontWeight: 'inherit', width: 320 }}
                  autoFocus
                />
              ) : (
                doc?.title ?? 'Loading…'
              )}
            </h1>
            {doc && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 12,
                  background: doc.status === 'published' ? 'var(--ps-success)20' : 'var(--ps-warning)20',
                  color: doc.status === 'published' ? 'var(--ps-success)' : 'var(--ps-warning)',
                }}
              >
                {doc.status === 'published'
                  ? `v${doc.version} Published`
                  : doc.status === 'archived'
                    ? `v${doc.version} Archived`
                    : 'Draft'}
              </span>
            )}
            {doc && doc.published_at && hasChanges && (
              <span
                title="Staff still read the last published version until you publish again"
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: 'var(--ps-warning)20', color: 'var(--ps-warning)' }}
              >
                Changes not published
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {editingMeta ? (
              <>
                <button className="ps-btn ps-btn-secondary" onClick={() => setEditingMeta(false)}>Cancel</button>
                <button className="ps-btn ps-btn-primary" onClick={saveMeta} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button className="ps-btn ps-btn-secondary" onClick={() => setEditingMeta(true)}>Edit Details</button>
                <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/assign`)}>Assign</button>
                <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/progress`)}>Progress</button>
                {doc?.published_at && (
                  <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/read`)}>Staff view</button>
                )}
                {doc?.status === 'published' && (
                  <button className="ps-btn ps-btn-secondary" onClick={handleArchive} disabled={saving}>Archive</button>
                )}
                {doc && (doc.status !== 'published' || hasChanges) && (
                  <button className="ps-btn ps-btn-primary" onClick={handlePublish} disabled={saving}>
                    {doc.status === 'archived' && !hasChanges
                      ? 'Restore'
                      : neverPublished
                        ? 'Publish'
                        : 'Publish new version'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {editingMeta && (
          <textarea
            className="ps-input"
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Description…"
            style={{ marginTop: 8, width: '100%' }}
          />
        )}
      </div>

      {doc && doc.status === 'published' && (
        <div className="ps-alert ps-alert-info" role="note" style={{ margin: '0 0 12px', fontSize: 13 }}>
          {hasChanges ? (
            <>
              <strong>You are editing a draft of version {doc.version + 1}.</strong> Staff still read version {doc.version}.
              When you publish the new version, everyone assigned is asked to read and sign it again.
            </>
          ) : (
            <>
              <strong>Version {doc.version} is published.</strong> Any change you make here is saved as a draft of version {doc.version + 1}.
              Staff keep reading version {doc.version} until you publish the new version, and then they sign again.
            </>
          )}
        </div>
      )}

      {doc && doc.status !== 'draft' && doc.review_interval_months !== undefined && <SOPReviewBar doc={doc} />}

      {error && (
        <div className="ps-alert ps-alert-error" style={{ margin: '0 0 12px' }}>
          {error}
          <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Split panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0, minHeight: 0 }}>

        {/* LEFT: Tree panel */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: '1px solid var(--ps-border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 12px 8px',
              borderBottom: '1px solid var(--ps-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ps-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Sections
            </span>
            <button
              title="Add root section"
              onClick={() => setAddingNode({ parentId: null })}
              style={{
                background: 'var(--ps-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >+ Add</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
            {activeNodeTree.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--ps-text-muted)', fontSize: 13 }}>
                No sections yet.
                <br />
                Click <strong>+ Add</strong> to start.
              </div>
            ) : (
              activeNodeTree.map((node) => (
                <TreeNodeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedNodeId}
                  onSelect={(id) => { void selectNode(id) }}
                  onAddChild={(parentId) => setAddingNode({ parentId })}
                  onRename={(n) => { setRenameNode(n); setRenameTitle(n.title) }}
                  onDelete={handleDeleteNode}
                  onMoveUp={(n) => handleMoveNode(n, 'up')}
                  onMoveDown={(n) => handleMoveNode(n, 'down')}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT: Content editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedNode ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--ps-text-muted)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ marginBottom: 12 }}><FileText size={26} strokeWidth={1.75} aria-hidden="true" /></div>
                <p>Select a section from the tree to edit its content,<br />or click <strong>+ Add</strong> to create a new section.</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Node header */}
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid var(--ps-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexShrink: 0,
                  flexWrap: 'wrap',
                }}
              >
                <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{selectedNode.title}</h2>

                {/* Content type */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['rich_text', 'pdf', 'none'] as const).map((ct) => (
                    <button
                      key={ct}
                      onClick={() => handleContentTypeChange(ct)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: `1px solid ${selectedNode.content_type === ct ? 'var(--ps-accent)' : 'var(--ps-border)'}`,
                        background: selectedNode.content_type === ct ? 'var(--ps-accent-bg)' : 'transparent',
                        color: selectedNode.content_type === ct ? 'var(--ps-accent)' : 'var(--ps-text-muted)',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: selectedNode.content_type === ct ? 600 : 400,
                      }}
                    >
                      {ct === 'rich_text' ? 'Text' : ct === 'pdf' ? 'PDF' : 'Header only'}
                    </button>
                  ))}
                </div>

                {selectedNode.content_type === 'rich_text' && (
                  <span role="status" aria-live="polite" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {saveState === 'unsaved' && <span style={{ color: 'var(--ps-text-muted)' }}>Unsaved changes</span>}
                    {saveState === 'saving' && <span style={{ color: 'var(--ps-text-muted)' }}>Saving…</span>}
                    {saveState === 'saved' && <span style={{ color: 'var(--ps-success)' }}>✓ Saved</span>}
                    {saveState === 'error' && (
                      <>
                        <span style={{ color: 'var(--ps-error)' }}>Not saved</span>
                        <button className="ps-btn ps-btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { void flushSave() }}>
                          Retry
                        </button>
                      </>
                    )}
                    {(saveState === 'unsaved' || saveState === 'error') && (
                      <button className="ps-btn ps-btn-secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => { void flushSave() }}>
                        Save now
                      </button>
                    )}
                  </span>
                )}
              </div>

              {/* Content area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {selectedNode.content_type === 'rich_text' && (
                  <RichTextEditor
                    key={selectedNode.id}
                    content={nodeContent}
                    onChange={handleContentChange}
                    placeholder="Start writing this section…"
                  />
                )}

                {selectedNode.content_type === 'pdf' && (
                  <div>
                    <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        className="ps-btn ps-btn-secondary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload PDF
                      </button>
                      {selectedNode.pdf_storage_path && (
                        <span style={{ fontSize: 12, color: 'var(--ps-success)' }}>
                          ✓ PDF uploaded
                        </span>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        style={{ display: 'none' }}
                        onChange={handlePDFUpload}
                      />
                    </div>

                    {pdfLoading && (
                      <div style={{ color: 'var(--ps-text-muted)', fontSize: 13 }}>Loading PDF…</div>
                    )}

                    {pdfUrl && (
                      <iframe
                        src={pdfUrl}
                        style={{ width: '100%', height: 600, border: '1px solid var(--ps-border)', borderRadius: 8 }}
                        title="PDF preview"
                      />
                    )}

                    {!pdfUrl && !pdfLoading && (
                      <div
                        style={{
                          border: '2px dashed var(--ps-border)',
                          borderRadius: 8,
                          padding: 48,
                          textAlign: 'center',
                          color: 'var(--ps-text-muted)',
                          cursor: 'pointer',
                        }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div style={{ marginBottom: 8 }}><FileText size={26} strokeWidth={1.75} aria-hidden="true" /></div>
                        <p>Click to upload a PDF</p>
                        <p style={{ fontSize: 12 }}>The PDF will be stored securely and accessible to assigned staff</p>
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.content_type === 'none' && (
                  <div
                    style={{
                      padding: 32,
                      textAlign: 'center',
                      color: 'var(--ps-text-muted)',
                      border: '1px dashed var(--ps-border)',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ marginBottom: 8 }}><Folder size={26} strokeWidth={1.75} aria-hidden="true" /></div>
                    <p>This section is a header/folder with no content.</p>
                    <p style={{ fontSize: 13 }}>Add child sections using the tree, or change the content type above.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add node modal */}
      <Modal
        isOpen={addingNode !== null}
        onClose={() => { setAddingNode(null); setNewNodeTitle('') }}
        title={addingNode?.parentId ? 'Add Child Section' : 'Add Root Section'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ps-form-group">
            <label className="ps-label">Section Title *</label>
            <input
              className="ps-input"
              value={newNodeTitle}
              onChange={(e) => setNewNodeTitle(e.target.value)}
              placeholder="e.g. 1.1 Prescription Reception"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setAddingNode(null); setNewNodeTitle('') }}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleAddNode} disabled={!newNodeTitle.trim()}>Add Section</button>
          </div>
        </div>
      </Modal>

      {/* Rename modal */}
      <Modal
        isOpen={renameNode !== null}
        onClose={() => { setRenameNode(null); setRenameTitle('') }}
        title="Rename Section"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ps-form-group">
            <label className="ps-label">New Title *</label>
            <input
              className="ps-input"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setRenameNode(null); setRenameTitle('') }}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleRenameConfirm} disabled={!renameTitle.trim()}>Rename</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
