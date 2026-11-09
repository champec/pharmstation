import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import JsBarcode from 'jsbarcode'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import { pepsDate, pepsDateTime, pepsCdSchedule, PEPS_CD_LABELS, type PepsEvent } from '@pharmstation/types'

function formatDateTime(value: string): string {
  return pepsDateTime(value)
}

export function PEPSPrintablePrescriptionPage() {
  const { id } = useParams<{ id: string }>()
  const { organisation, isOrgLoggedIn, isUserLoggedIn } = useAuthStore()
  const { activePrescription: rx, activeItems, activeEvents, fetchPrescription, logEvent, loading, error } = usePepsStore()

  const barcodeRef = useRef<SVGSVGElement | null>(null)
  const [recorded, setRecorded] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  useEffect(() => {
    if (id) fetchPrescription(id)
  }, [id, fetchPrescription])

  const printEvents = useMemo(() => {
    return activeEvents
      .filter((ev) => ev.event_type === 'printed' || (ev.event_type === 'downloaded' && Boolean((ev.metadata as Record<string, unknown> | null)?.document_print)))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [activeEvents])

  const firstPrint = printEvents[0] ?? null
  // Every print is a COPY: the electronic prescription in PEPS is the original,
  // so a paper print can never be dispensed as a second original.
  const mode = 'COPY' as const

  const originalInfo = useMemo(() => {
    if (!firstPrint) return null
    const metadata = (firstPrint.metadata as Record<string, unknown> | null) ?? {}
    return {
      pharmacyName: String(metadata.pharmacy_name ?? organisation?.name ?? 'Unknown pharmacy'),
      printedAt: String(metadata.printed_at ?? firstPrint.created_at),
    }
  }, [firstPrint, organisation?.name])

  const uniqueCode = (rx?.unique_code || rx?.prescription_ref || 'UNKNOWN').trim()

  useEffect(() => {
    if (!barcodeRef.current || !uniqueCode) return
    JsBarcode(barcodeRef.current, uniqueCode, {
      format: 'CODE128',
      lineColor: '#111827',
      width: 1.8,
      height: 58,
      margin: 4,
      displayValue: true,
      fontSize: 12,
    })
  }, [uniqueCode])

  useEffect(() => {
    if (!rx || !organisation?.id || !organisation?.name || recorded) return

    let cancelled = false
    const run = async () => {
      try {
        const metadata = {
          document_print: true,
          print_mode: mode,
          pharmacy_name: organisation.name,
          printed_at: new Date().toISOString(),
          original_pharmacy_name: originalInfo?.pharmacyName ?? organisation.name,
          original_printed_at: originalInfo?.printedAt ?? null,
        }

        await logEvent(rx.id, 'printed', metadata)

        if (cancelled) return
        setRecorded(true)
        setTimeout(() => {
          window.focus()
          window.print()
        }, 600)
      } catch (e: any) {
        if (!cancelled) setRecordError(e.message)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [logEvent, mode, organisation?.id, organisation?.name, originalInfo?.pharmacyName, originalInfo?.printedAt, recorded, rx])

  if (!isOrgLoggedIn) return <Navigate to="/login/org" replace />
  if (!isUserLoggedIn) return <Navigate to="/login/user" replace />

  if (loading && !rx) return <div style={{ padding: '1.5rem' }}>Loading prescription...</div>
  if (!rx) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <p>{error ?? 'Prescription not found.'}</p>
        <Link to="/peps" className="ps-btn ps-btn-secondary">Back to PEPS</Link>
      </div>
    )
  }

  return (
    <div className="peps-print-shell">
      <style>{`
        @page { size: A4; margin: 12mm; }
        body { background: #eef2f7; }
        @media print {
          body { background: #fff; margin: 0; }
          .peps-print-shell,
          .peps-print-shell * {
            visibility: visible !important;
          }
          .peps-print-toolbar { display: none !important; }
          .peps-print-shell {
            position: absolute;
            inset: 0;
            display: block;
            min-height: auto;
            padding: 0;
            background: #fff;
          }
          .peps-print-sheet {
            width: auto;
            min-height: auto;
            border: 0;
            border-radius: 0;
            padding: 0;
            box-shadow: none;
            margin: 0;
            break-inside: avoid;
          }
        }
        .peps-print-shell {
          min-height: 100vh;
          padding: 24px;
          display: flex;
          justify-content: center;
          background: #eef2f7;
          font-family: "Segoe UI", Arial, sans-serif;
        }
        .peps-print-toolbar {
          position: fixed;
          top: 16px;
          right: 16px;
          display: flex;
          gap: 8px;
          z-index: 10;
        }
        .peps-print-sheet {
          width: 190mm;
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 14mm;
          box-sizing: border-box;
          position: relative;
          color: #0f172a;
        }
        .peps-print-watermark {
          position: absolute;
          top: 42%;
          left: 11%;
          font-size: 96px;
          font-weight: 800;
          color: rgba(220, 38, 38, 0.14);
          transform: rotate(-20deg);
          letter-spacing: 8px;
          pointer-events: none;
        }
        .peps-print-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }
        .peps-print-title {
          margin: 0 0 6px;
          font-size: 24px;
        }
        .peps-print-meta {
          margin: 2px 0;
          font-size: 12px;
          color: #334155;
        }
        .peps-print-mode-copy { color: #b91c1c; font-weight: 700; }
        .peps-print-copy-note {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 600;
          color: #991b1b;
        }
        .peps-print-sign img {
          margin-top: 8px;
          max-width: 220px;
          max-height: 72px;
          object-fit: contain;
        }
        .peps-print-section {
          border-top: 1px solid #e2e8f0;
          margin-top: 12px;
          padding-top: 12px;
        }
        .peps-print-items {
          margin: 8px 0 0;
          padding-left: 18px;
        }
        .peps-print-items li {
          margin-bottom: 8px;
        }
        .peps-print-dose {
          font-size: 12px;
          color: #475569;
          margin-top: 2px;
        }
        .peps-print-legal {
          margin-top: 12px;
          border: 1px solid #cbd5e1;
          border-left: 4px solid #0f766e;
          background: #f8fafc;
          padding: 10px;
          font-size: 12px;
          line-height: 1.45;
        }
        .peps-print-barcode {
          margin-top: 12px;
          text-align: center;
        }
        .peps-print-foot {
          display: flex;
          justify-content: space-between;
          margin-top: 12px;
          font-size: 12px;
          color: #334155;
        }
      `}</style>

      <div className="peps-print-toolbar">
        <Link className="ps-btn ps-btn-ghost" to={`/peps/${rx.id}`}>Back</Link>
        <button className="ps-btn ps-btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      <article className="peps-print-sheet">
        <div className="peps-print-watermark">COPY</div>
        <header className="peps-print-head">
          <div>
            <h1 className="peps-print-title">{rx.prescription_type === 'vet' ? 'Veterinary Prescription' : 'Private Prescription'}</h1>
            <p className="peps-print-meta">Reference: {rx.prescription_ref}</p>
            <p className="peps-print-meta">Date: {pepsDate(rx.prescription_date)}</p>
            {rx.prescription_type === 'vet' ? (
              <>
                <p className="peps-print-meta">Animal: {rx.animal_name ?? '—'}</p>
                <p className="peps-print-meta">Owner: {rx.animal_owner ?? rx.patient_snapshot?.full_name ?? '—'}</p>
              </>
            ) : (
              <>
                <p className="peps-print-meta">Patient: {rx.patient_snapshot?.full_name ?? 'Unknown patient'}</p>
                {rx.patient_snapshot?.dob && <p className="peps-print-meta">DOB: {pepsDate(rx.patient_snapshot.dob)}</p>}
              </>
            )}
            {rx.patient_snapshot?.address && <p className="peps-print-meta">Address: {rx.patient_snapshot.address}</p>}
            {rx.expires_at && <p className="peps-print-meta">Valid until: {pepsDate(rx.expires_at)}</p>}
            <p className="peps-print-meta">
              <span className="peps-print-mode-copy">COPY — NOT VALID FOR DISPENSING</span>
            </p>
            {originalInfo && (
              <p className="peps-print-copy-note">
                First printed by {originalInfo.pharmacyName} at {formatDateTime(originalInfo.printedAt)}
              </p>
            )}
          </div>
          <div className="peps-print-sign">
            <div><strong>{rx.prescriber_snapshot?.full_name}</strong></div>
            <p className="peps-print-meta">{rx.prescriber_snapshot?.registration_body} {rx.prescriber_snapshot?.registration_number}</p>
            <p className="peps-print-meta">{rx.prescribing_org_snapshot?.name ?? organisation?.name}</p>
            {rx.prescriber_snapshot?.address && <p className="peps-print-meta">{rx.prescriber_snapshot.address}</p>}
            {rx.signature_data && <img src={rx.signature_data} alt="Signature" />}
          </div>
        </header>

        <section className="peps-print-section">
          <strong>Medication</strong>
          <ol className="peps-print-items">
            {activeItems.map((item, idx) => (
              <li key={item.id}>
                <div><strong>{idx + 1}. {item.drug_name}</strong> - {item.quantity}</div>
                {item.dosage && <div className="peps-print-dose">{item.dosage}</div>}
                {item.cd_category && item.cd_category !== '0000' && (
                  <div className="peps-print-dose">{PEPS_CD_LABELS[pepsCdSchedule(item.cd_category)]}</div>
                )}
              </li>
            ))}
          </ol>
          {rx.cascade_wording && <p className="peps-print-dose"><em>{rx.cascade_wording}</em></p>}
        </section>

        <section className="peps-print-barcode">
          <svg ref={barcodeRef} role="img" aria-label="Prescription barcode" />
          <div className="peps-print-meta">Unique prescription code: {uniqueCode}</div>
        </section>

        <section className="peps-print-legal">
          This printout is a copy for records only. The original is the electronic prescription in PEPS, linked to this unique code and audit trail. Do not dispense from this paper.
        </section>

        <footer className="peps-print-foot">
          <span>Printed by {organisation?.name}</span>
          <span>{formatDateTime(new Date().toISOString())}</span>
        </footer>

        {recordError && (
          <p className="ps-alert ps-alert-error" style={{ marginTop: '10px' }}>
            Could not record print event: {recordError}
          </p>
        )}
      </article>
    </div>
  )
}
