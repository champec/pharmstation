import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { useEffect, useCallback, useRef } from 'react'
import { promptDialog } from '../ui/dialog'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  editable?: boolean
  placeholder?: string
}

const ToolbarButton = ({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{
      padding: '4px 8px',
      borderRadius: 4,
      border: active ? '1px solid var(--ps-accent)' : '1px solid transparent',
      background: active ? 'var(--ps-accent-bg)' : 'transparent',
      color: active ? 'var(--ps-accent)' : 'var(--ps-text)',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: active ? 600 : 400,
    }}
  >
    {children}
  </button>
)

export function RichTextEditor({ content, onChange, editable = true, placeholder }: RichTextEditorProps) {
  // Always call the latest onChange (the editor is created once).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    extensions: [
      // StarterKit v3 already includes Link and Underline.
      StarterKit.configure({ link: { openOnClick: false } }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content || '',
    editable,
    // Only real edits by the user count as changes. Loading or switching
    // content must never trigger a save (it used to wipe sections).
    onUpdate: ({ editor: e, transaction }) => {
      if (!transaction.docChanged || transaction.getMeta('preventUpdate')) return
      onChangeRef.current(e.getHTML())
    },
  })

  // Sync external content changes (e.g. switching nodes)
  useEffect(() => {
    if (!editor) return
    const next = content || ''
    const current = editor.getHTML()
    // An empty editor reports '<p></p>'; treat that as the same as ''.
    if (next === current || (!next && editor.isEmpty)) return
    editor.commands.setContent(next, { emitUpdate: false })
  }, [content, editor])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editable, editor])

  const addLink = useCallback(async () => {
    if (!editor) return
    const url = await promptDialog('Enter URL:')
    if (url) {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  const insertTable = useCallback(() => {
    if (!editor) return
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div className="rte-wrapper">
      {editable && (
        <div className="rte-toolbar">
          {/* Text style */}
          <div className="rte-toolbar-group">
            <select
              value={
                editor.isActive('heading', { level: 1 })
                  ? 'h1'
                  : editor.isActive('heading', { level: 2 })
                  ? 'h2'
                  : editor.isActive('heading', { level: 3 })
                  ? 'h3'
                  : 'p'
              }
              onChange={(e) => {
                if (e.target.value === 'p') editor.chain().focus().setParagraph().run()
                else
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({ level: parseInt(e.target.value.slice(1)) as 1 | 2 | 3 })
                    .run()
              }}
              style={{
                border: '1px solid var(--ps-border)',
                borderRadius: 4,
                padding: '3px 6px',
                background: 'var(--ps-surface)',
                color: 'var(--ps-text)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <option value="p">Paragraph</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
          </div>

          <div className="rte-toolbar-separator" />

          {/* Basic formatting */}
          <div className="rte-toolbar-group">
            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <strong>B</strong>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <em>I</em>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="Underline"
            >
              <span style={{ textDecoration: 'underline' }}>U</span>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="Strikethrough"
            >
              <span style={{ textDecoration: 'line-through' }}>S</span>
            </ToolbarButton>
          </div>

          <div className="rte-toolbar-separator" />

          {/* Alignment */}
          <div className="rte-toolbar-group">
            <ToolbarButton
              active={editor.isActive({ textAlign: 'left' })}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              title="Align left"
            >≡</ToolbarButton>
            <ToolbarButton
              active={editor.isActive({ textAlign: 'center' })}
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
              title="Align center"
            >⊟</ToolbarButton>
            <ToolbarButton
              active={editor.isActive({ textAlign: 'right' })}
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
              title="Align right"
            >▶</ToolbarButton>
          </div>

          <div className="rte-toolbar-separator" />

          {/* Lists */}
          <div className="rte-toolbar-group">
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            >• List</ToolbarButton>
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            >1. List</ToolbarButton>
          </div>

          <div className="rte-toolbar-separator" />

          {/* Extras */}
          <div className="rte-toolbar-group">
            <ToolbarButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              title="Block quote"
            >" Quote</ToolbarButton>
            <ToolbarButton
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title="Inline code"
            >{`< >`}</ToolbarButton>
            <ToolbarButton
              active={editor.isActive('link')}
              onClick={addLink}
              title="Add link"
            >🔗</ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={insertTable}
              title="Insert table"
            >⊞ Table</ToolbarButton>
          </div>

          <div className="rte-toolbar-separator" />

          {/* Undo/Redo */}
          <div className="rte-toolbar-group">
            <ToolbarButton
              onClick={() => editor.chain().focus().undo().run()}
              title="Undo"
            >↩</ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().redo().run()}
              title="Redo"
            >↪</ToolbarButton>
          </div>
        </div>
      )}

      <EditorContent
        editor={editor}
        className="rte-content"
        style={{
          minHeight: editable ? 300 : undefined,
        }}
      />

      {editable && !editor.getText() && placeholder && (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            top: 0,
            left: 0,
            color: 'var(--ps-text-muted)',
            padding: '12px 16px',
            fontSize: 14,
          }}
        >
          {placeholder}
        </div>
      )}
    </div>
  )
}
