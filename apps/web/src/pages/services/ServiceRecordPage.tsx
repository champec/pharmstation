import { useNavigate, useParams } from 'react-router-dom'
import { ServiceRecordView } from '../../components/services/ServiceRecordView'

export function ServiceRecordPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>()
  const navigate = useNavigate()

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <a href="/services/deliveries" onClick={(e) => { e.preventDefault(); navigate('/services/deliveries') }}>Service History</a>
          <span className="separator">/</span>
          <span>Record</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📄 Service Record</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>
      {deliveryId && <ServiceRecordView deliveryId={deliveryId} />}
    </div>
  )
}
