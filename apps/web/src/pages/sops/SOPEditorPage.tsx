import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore } from '@pharmstation/core'
import type { SOPNode } from '@pharmstation/types'
import { RichTextEditor } from '../../components/sop/RichTextEditor'
import { Modal } from '../../components/Modal'

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
          {node.content_type === 'pdf' ? '📄' : node.content_type === 'none' ? '📁' : '📝'}
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
            >✏</button>
            <button
              title="Delete"
              onClick={() => onDelete(node)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 2, color: 'var(--ps-danger)' }}
            >✕</button>
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
  const { organisation, activeUser } = useAuthStore()

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

  // Auto-save node content (debounced)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleContentChange = useCallback(
    (html: string) => {
      setNodeContent(html)
      setNodeHasUnsaved(true)
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(async () => {
        if (selectedNodeId) {
          await updateNode(selectedNodeId, { rich_content: html })
          setNodeHasUnsaved(false)
        }
      }, 1500)
    },
    [selectedNodeId, updateNode]
  )

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
    if (!file || !selectedNodeId || !docId) return
    try {
      await uploadNodePDF(selectedNodeId, docId, file)
      // Reload URL
      const node = activeNodes.find((n) => n.id === selectedNodeId)
      if (node?.pdf_storage_path) {
        const url = await getNodePDFUrl(node.pdf_storage_path)
        setPdfUrl(url)
      }
    } catch (e: any) {
      alert(`Upload failed: ${e.message}`)
    }
  }

  const handlePublish = async () => {
    if (!docId) return
    const msg = activeDocument?.status === 'published'
      ? 'Publishing will increment the version number and require all assigned staff to re-read this SOP. Continue?'
      : 'Publish this SOP to make it visible to assigned staff?'
    if (!confirm(msg)) return
    await publishDocument(docId)
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
                {doc.status === 'published' ? `v${doc.version} Published` : 'Draft'}
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
                <button className="ps-btn ps-btn-secondary" onClick={() => setEditingMeta(true)}>✏️ Edit Details</button>
                <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/assign`)}>👥 Assign</button>
                <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/progress`)}>📊 Progress</button>
                {doc?.status !== 'archived' && (
                  <button className="ps-btn ps-btn-primary" onClick={handlePublish} disabled={saving}>
                    {doc?.status === 'published' ? '🔄 Publish New Version' : '🚀 Publish'}
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
                  onSelect={setSelectedNode}
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
                <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
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
                      {ct === 'rich_text' ? '📝 Text' : ct === 'pdf' ? '📄 PDF' : '📁 Header only'}
                    </button>
                  ))}
                </div>

                {nodeHasUnsaved && (
                  <span style={{ fontSize: 12, color: 'var(--ps-text-muted)' }}>Auto-saving…</span>
                )}
                {saving && !nodeHasUnsaved && (
                  <span style={{ fontSize: 12, color: 'var(--ps-success)' }}>✓ Saved</span>
                )}
              </div>

              {/* Content area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {selectedNode.content_type === 'rich_text' && (
                  <RichTextEditor
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
                        📎 Upload PDF
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
                        <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
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
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
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
