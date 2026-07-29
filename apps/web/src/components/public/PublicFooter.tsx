export function PublicFooter() {
  return (
    <footer className="public-site-footer">
      <div className="public-site-footer-brand">
        <span className="public-site-wordmark">Pharm<span>Station</span></span>
        <p>Local pharmacy shopping and appointments, with professional care built in.</p>
      </div>
      <div>
        <strong>Explore</strong>
        <a href="/shop">Shop</a>
        <a href="/book">Book services</a>
        <a href="/maps">Find a pharmacy</a>
      </div>
      <div>
        <strong>Account</strong>
        <a href="/patient/login">Sign in</a>
        <a href="/privacy">Privacy</a>
      </div>
      <small>Services, appointments and orders are provided directly by participating pharmacies.<br />© {new Date().getFullYear()} PharmStation</small>
    </footer>
  )
}