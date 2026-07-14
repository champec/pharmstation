import { Modal } from '../Modal'
import type { CDEntryWarning } from '../../utils/cdEntryWarnings'

interface CDEntryWarningModalProps {
  isOpen: boolean
  warnings: CDEntryWarning[]
  submitting?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function CDEntryWarningModal({
  isOpen,
  warnings,
  submitting = false,
  onCancel,
  onConfirm,
}: CDEntryWarningModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="⚠️ Check this entry" width="520px">
      <p className="entry-warning-intro">
        This entry cannot be edited after submission. Please check:
      </p>
      <ul className="entry-warning-list">
        {warnings.map((warning) => (
          <li key={warning.id} className="entry-warning-item">
            <strong>{warning.title}</strong>
            <span>{warning.detail}</span>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="ps-btn ps-btn-ghost" onClick={onCancel} disabled={submitting}>
          Go back
        </button>
        <button type="button" className="ps-btn ps-btn-primary" onClick={onConfirm} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit anyway'}
        </button>
      </div>
    </Modal>
  )
}
