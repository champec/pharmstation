import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Shared header and footer for the public website, so pages like About, Privacy, the pharmacy map
// and the sign-in screens match the landing page. Booking, shop and resources keep their own chrome.

export const CONTACT_EMAIL = 'hello@pharmstation.co.uk'

export function PublicSiteHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="landing-nav">
      <Link to="/" className="landing-wordmark" aria-label="PharmStation home">
        <img src="/favicon.svg" alt="" width={30} height={30} />
        <span>Pharm<span>Station</span></span>
      </Link>
      <nav aria-label="Main">
        <Link to="/book">Book an appointment</Link>
        <Link to="/shop">Shop</Link>
        <Link to="/maps">Find a pharmacy</Link>
        <Link to="/resources">Free resources</Link>
      </nav>
      <div className="landing-nav-actions">
        {actions ?? <Link to="/login/org" className="landing-btn landing-btn-ghost">Sign in</Link>}
      </div>
    </header>
  )
}

export function PublicSiteFooter() {
  return (
    <footer className="public-site-footer">
      <div className="public-site-footer-brand">
        <span className="public-site-wordmark">Pharm<span>Station</span></span>
        <p>The digital workstation for UK community pharmacies.</p>
      </div>
      <div>
        <strong>Pharmacies</strong>
        <a href="/#features">Features</a>
        <a href="/#pricing">Pricing</a>
        <Link to="/resources">Free resources</Link>
        <Link to="/login/org">Sign in</Link>
      </div>
      <div>
        <strong>Patients</strong>
        <Link to="/book">Book services</Link>
        <Link to="/shop">Shop</Link>
        <Link to="/maps">Find a pharmacy</Link>
        <Link to="/patient/login">Patient sign in</Link>
      </div>
      <small>
        <Link to="/about">About</Link> · <Link to="/contact">Contact</Link> · <Link to="/privacy">Privacy</Link> · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <br />© {new Date().getFullYear()} PharmStation
      </small>
    </footer>
  )
}

/**
 * Page frame for simple public pages. `variant="narrow"` centres a single card (sign-in forms),
 * the default gives a readable article column.
 */
export function PublicSiteShell({
  children,
  variant = 'article',
  headerActions,
}: {
  children: ReactNode
  variant?: 'article' | 'narrow' | 'wide'
  headerActions?: ReactNode
}) {
  return (
    <div className="landing public-shell">
      <PublicSiteHeader actions={headerActions} />
      <main className={`public-shell-main public-shell-${variant}`}>{children}</main>
      <PublicSiteFooter />
    </div>
  )
}
