import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  /** A lucide-react icon, e.g. `icon={Inbox}`. */
  icon?: LucideIcon
  title: ReactNode
  /** One or two sentences: what will appear here and how to get started. */
  children?: ReactNode
  /** Usually one primary button, optionally a secondary one before it. */
  actions?: ReactNode
  /** Renders without the white card, for use inside an existing card or table. */
  bare?: boolean
}

/** The one empty state used across the staff app. */
export function EmptyState({ icon: Icon, title, children, actions, bare }: EmptyStateProps) {
  return (
    <div className={`ps-empty${bare ? ' bare' : ''}`}>
      {Icon && (
        <span className="ps-empty-icon" aria-hidden="true">
          <Icon size={26} strokeWidth={1.75} />
        </span>
      )}
      <h2 className="ps-empty-title">{title}</h2>
      {children && <div className="ps-empty-text">{children}</div>}
      {actions && <div className="ps-empty-actions">{actions}</div>}
    </div>
  )
}
