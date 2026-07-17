import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'
import { resourceCategories } from './resourceCatalog'

const categoryLinks = {
  'service-forms': '/resources/forms',
  'patient-leaflets': '/resources/pils',
  'printable-logs': '/resources/logs',
  'operational-tools': '/resources/tools',
}

export function ResourcesPage() {
  return (
    <div className="resource-shell">
      <ResourceHeader />
      <main>
        <section className="resource-intro">
          <p className="resource-kicker">Free pharmacy resources</p>
          <h1>Reliable print resources, ready when the usual systems are not.</h1>
          <p>
            Curated forms and medicine information for community pharmacy teams. Find the document you need,
            print it, and get back to the patient.
          </p>
        </section>

        <section className="resource-category-grid" aria-label="Resource categories">
          {resourceCategories.map((category, index) => {
            const to = categoryLinks[category.id]
            const content = (
              <>
                <div className="resource-category-number">0{index + 1}</div>
                <div>
                  <span className="resource-category-status">{category.status}</span>
                  <h2>{category.title}</h2>
                  <p>{category.description}</p>
                </div>
                <span className="resource-category-action">{to ? 'Browse resources' : 'In preparation'}</span>
              </>
            )

            return to ? (
              <Link className="resource-category-card" key={category.id} to={to}>{content}</Link>
            ) : (
              <div className="resource-category-card is-disabled" key={category.id}>{content}</div>
            )
          })}
        </section>

        <section className="resource-trust-strip">
          <strong>Built for continuity</strong>
          <span>Public access</span>
          <span>No account required</span>
          <span>Curated for UK community pharmacy</span>
        </section>
      </main>
      <footer className="resource-footer">
        <span>PharmStation</span>
        <span>Check local requirements and current service specifications before use.</span>
      </footer>
    </div>
  )
}