import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface Crumb {
  label: string
  /** Leave out for the current page (the last crumb). */
  to?: string
}

interface PageHeaderProps {
  title: ReactNode
  /** One short sentence under the title. */
  subtitle?: ReactNode
  /** Small uppercase label above the title, e.g. the module name. Optional. */
  eyebrow?: string
  breadcrumbs?: Crumb[]
  /** Buttons on the right. Put the primary action last. */
  actions?: ReactNode
  className?: string
}

/**
 * The one page header used across the staff app:
 * breadcrumb, optional eyebrow, title (no emoji), subtitle, actions on the right.
 * See /mnt/project-files/design/design-rules.md.
 */
export function PageHeader({ title, subtitle, eyebrow, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={`ps-page-header${className ? ` ${className}` : ''}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="ps-breadcrumb">
              {i > 0 && <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="ps-page-header-row">
        <div className="ps-page-header-text">
          {eyebrow && <p className="ps-eyebrow">{eyebrow}</p>}
          <h1 className="ps-page-title">{title}</h1>
          {subtitle && <p className="ps-page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="ps-page-actions">{actions}</div>}
      </div>
    </header>
  )
}
