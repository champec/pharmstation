import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore } from '@pharmstation/core'
import type { SOPNode } from '@pharmstation/types'
import { RichTextEditor } from '../../components/sop/RichTextEditor'

// Flat tree node for read view sidebar
function ReadTreeItem({
  node,
  depth,
  selectedId,
  onSelect,
  completedNodeIds,
}: {
  node: SOPNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  completedNodeIds: Set<string>
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = (node.children?.length ?? 0) > 0
  const isSelected = selectedId === node.id
  const isDone = completedNodeIds.has(node.id)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: depth * 16 + 6,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          borderRadius: 6,
          background: isSelected ? 'var(--ps-accent-bg)' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={() => onSelect(node.id)}
      >
        <span
          style={{ width: 14, fontSize: 11, color: 'var(--ps-text-muted)', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span style={{ fontSize: 12, marginRight: 2 }}>
          {node.content_type === 'pdf' ? '📄' : node.content_type === 'none' ? '📁' : '📝'}
        </span>
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
        {isDone && <span style={{ fontSize: 12, color: 'var(--ps-success)' }}>✓</span>}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <ReadTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              completedNodeIds={completedNodeIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SOPReadPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()

  const {
    activeDocument,
    activeNodes,
    activeNodeTree,
    selectedNodeId,
    completions,
    loading,
    fetchDocument,
    fetchCompletions,
    markComplete,
    getNodePDFUrl,
    setSelectedNode,
  } = useSOPStore()

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    if (docId) fetchDocument(docId)
  }, [docId, fetchDocument])

  useEffect(() => {
    if (docId && organisation?.id) fetchCompletions(docId, organisation.id)
  }, [docId, organisation?.id])

  const selectedNode = activeNodes.find((n) => n.id === selectedNodeId) ?? null

  // Load PDF when node changes
  useEffect(() => {
    setPdfUrl(null)
    if (selectedNode?.content_type === 'pdf' && selectedNode?.pdf_storage_path) {
      setPdfLoading(true)
      getNodePDFUrl(selectedNode.pdf_storage_path).then((url) => {
        setPdfUrl(url)
        setPdfLoading(false)
      })
    }
  }, [selectedNodeId])

  // Auto-select first node
  useEffect(() => {
    if (activeNodeTree.length > 0 && !selectedNodeId) {
      // Find first node with content
      const first = activeNodes.find((n) => n.content_type !== 'none') ?? activeNodes[0]
      if (first) setSelectedNode(first.id)
    }
  }, [activeNodeTree.length])

  const myCompletion = completions.find(
    (c) => c.document_id === docId && c.member_id === membership?.id
  )
  const isCurrentVersion = myCompletion?.document_version === activeDocument?.version
  const needsReread = myCompletion && !isCurrentVersion

  const handleMarkComplete = async () => {
    if (!docId || !membership?.id || !organisation?.id || !activeDocument) return
    setMarking(true)
    try {
      await markComplete(docId, activeDocument.version, membership.id, organisation.id)
    } finally {
      setMarking(false)
    }
  }

  // Navigate through nodes (prev/next)
  const flatNodes = activeNodes.filter((n) => n.content_type !== 'none')
  const currentIdx = flatNodes.findIndex((n) => n.id === selectedNodeId)

  if (loading && !activeDocument) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--ps-text-muted)' }}>Loading…</div>
  }

  const doc = activeDocument

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/sops" onClick={(e) => { e.preventDefault(); navigate('/sops') }}>SOPs</a>
          <span className="separator">/</span>
          <span>{doc?.title ?? 'Loading…'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0 }}>{doc?.title}</h1>
            {doc && (
              <span style={{ fontSize: 11, color: 'var(--ps-text-muted)' }}>v{doc.version}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {needsReread && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 12,
                  background: 'var(--ps-warning)20',
                  color: 'var(--ps-warning)',
                }}
              >
                ⚠ New version — please re-read
              </span>
            )}
            {isCurrentVersion && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 12,
                  background: 'var(--ps-success)20',
                  color: 'var(--ps-success)',
                }}
              >
                ✓ Completed {new Date(myCompletion!.completed_at).toLocaleDateString()}
              </span>
            )}
            {!isCurrentVersion && (
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleMarkComplete}
                disabled={marking}
              >
                {marking ? 'Saving…' : '✓ Mark as Read & Complete'}
              </button>
            )}
          </div>
        </div>
        {doc?.description && (
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ps-text-muted)' }}>{doc.description}</p>
        )}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            borderRight: '1px solid var(--ps-border)',
            overflowY: 'auto',
            padding: '12px 6px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ps-text-muted)', textTransform: 'uppercase', letterSpacing: 1, padding: '0 6px', marginBottom: 8 }}>
            Contents
          </div>
          {activeNodeTree.map((node) => (
            <ReadTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedNodeId}
              onSelect={setSelectedNode}
              completedNodeIds={new Set()}
            />
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedNode ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--ps-text-muted)' }}>
              Select a section from the contents panel
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 860 }}>
              <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: 22 }}>{selectedNode.title}</h2>

              {selectedNode.content_type === 'rich_text' && (
                <RichTextEditor
                  content={selectedNode.rich_content ?? ''}
                  onChange={() => {}}
                  editable={false}
                />
              )}

              {selectedNode.content_type === 'pdf' && (
                <div>
                  {pdfLoading && <div style={{ color: 'var(--ps-text-muted)' }}>Loading PDF…</div>}
                  {pdfUrl && (
                    <>
                      <a
                        href={pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ps-btn ps-btn-secondary"
                        style={{ marginBottom: 12, display: 'inline-block' }}
                      >
                        🔗 Open in new tab
                      </a>
                      <iframe
                        src={pdfUrl}
                        style={{ width: '100%', height: 600, border: '1px solid var(--ps-border)', borderRadius: 8 }}
                        title="PDF"
                      />
                    </>
                  )}
                  {!pdfUrl && !pdfLoading && (
                    <div style={{ color: 'var(--ps-text-muted)', padding: 32, textAlign: 'center' }}>
                      No PDF has been uploaded for this section yet.
                    </div>
                  )}
                </div>
              )}

              {selectedNode.content_type === 'none' && (
                <div style={{ color: 'var(--ps-text-muted)', padding: '24px 0', fontSize: 14 }}>
                  This is a header section. Select a sub-section from the contents panel.
                </div>
              )}

              {/* Prev / Next Navigation */}
              <div style={{ display: 'flex', gap: 12, marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--ps-border)' }}>
                {currentIdx > 0 && (
                  <button
                    className="ps-btn ps-btn-secondary"
                    onClick={() => setSelectedNode(flatNodes[currentIdx - 1].id)}
                  >
                    ← {flatNodes[currentIdx - 1].title}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {currentIdx < flatNodes.length - 1 ? (
                  <button
                    className="ps-btn ps-btn-secondary"
                    onClick={() => setSelectedNode(flatNodes[currentIdx + 1].id)}
                  >
                    {flatNodes[currentIdx + 1].title} →
                  </button>
                ) : (
                  !isCurrentVersion && (
                    <button
                      className="ps-btn ps-btn-primary"
                      onClick={handleMarkComplete}
                      disabled={marking}
                    >
                      {marking ? 'Saving…' : '✓ I have read this SOP — Mark Complete'}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
