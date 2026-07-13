import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarcodeDetector } from 'barcode-detector/ponyfill'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { Modal } from '../Modal'

interface CatalogueDrug {
  id: string
  drug_brand: string | null
  drug_class: string | null
  drug_form: string | null
  drug_strength: string | null
  drug_type: string | null
  units: string | null
}

interface BarcodeLookupResult {
  found: boolean
  gtin: string
  matched_gtin?: string
  message?: string
  historical?: boolean
  gtin_valid_from?: string | null
  gtin_valid_to?: string | null
  supplemental_mapping?: {
    source_name: string
    source_url: string | null
    verified_at: string
  } | null
  pack?: { appid: string; nm: string; apid: string; legal_catcd: string | null }
  product?: { apid: string; nm: string; vpid: string | null } | null
  virtual_pack?: { nm: string; qtyval: number | null; qty_uomcd: string | null } | null
  virtual_product?: { nm: string; cat_cd: string | null } | null
  catalogue_match?: CatalogueDrug | null
  organisation_register?: { id: string; drug_id: string } | null
  ledger?: { id: string; current_balance: number; is_active: boolean; entry_count: number } | null
}

interface ParsedBarcode {
  gtin: string
  expiry: string | null
  batch: string | null
  serial: string | null
}

interface BarcodeScanModalProps {
  isOpen: boolean
  onClose: () => void
}

const GS = '\u001d'

function normalizeExpiry(value: string | null): string | null {
  if (!value || !/^\d{6}$/.test(value)) return null
  const year = 2000 + Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  let day = Number(value.slice(4, 6))
  if (month < 1 || month > 12) return null
  if (day === 0) day = new Date(year, month, 0).getDate()
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function readVariableAi(payload: string, start: number): { value: string; next: number } {
  const separator = payload.indexOf(GS, start)
  const next = separator === -1 ? payload.length : separator + 1
  return { value: payload.slice(start, separator === -1 ? payload.length : separator), next }
}

export function parseMedicineBarcode(rawValue: string): ParsedBarcode {
  let payload = rawValue.trim().replace(/^\]d2/, '')
  const parenthesizedGtin = payload.match(/\(01\)\s*(\d{14})/)
  if (parenthesizedGtin) {
    return {
      gtin: parenthesizedGtin[1],
      expiry: normalizeExpiry(payload.match(/\(17\)\s*(\d{6})/)?.[1] ?? null),
      batch: payload.match(/\(10\)\s*([^()\u001d]+)/)?.[1]?.trim() ?? null,
      serial: payload.match(/\(21\)\s*([^()\u001d]+)/)?.[1]?.trim() ?? null,
    }
  }

  const manuallyFormattedGtin = payload.replace(/[\s-]/g, '')
  if (/^\d{13,14}$/.test(manuallyFormattedGtin)) {
    return { gtin: manuallyFormattedGtin, expiry: null, batch: null, serial: null }
  }

  const firstGtin = payload.match(/(?:^|\u001d)01(\d{14})/)
  if (!firstGtin) throw new Error('This barcode does not contain a GTIN medicine identifier (AI 01).')

  const parsed: ParsedBarcode = { gtin: firstGtin[1], expiry: null, batch: null, serial: null }
  let cursor = (firstGtin.index ?? 0) + firstGtin[0].length
  while (cursor < payload.length) {
    if (payload[cursor] === GS) {
      cursor += 1
      continue
    }
    const ai = payload.slice(cursor, cursor + 2)
    cursor += 2
    if (ai === '17') {
      parsed.expiry = normalizeExpiry(payload.slice(cursor, cursor + 6))
      cursor += 6
    } else if (ai === '10' || ai === '21') {
      const variable = readVariableAi(payload, cursor)
      if (ai === '10') parsed.batch = variable.value || null
      else parsed.serial = variable.value || null
      cursor = variable.next
    } else {
      break
    }
  }
  return parsed
}

function hasValidGtinCheckDigit(gtin: string): boolean {
  const digits = gtin.split('').map(Number)
  const checkDigit = digits.pop()
  if (checkDigit === undefined) return false
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === checkDigit
}

export function BarcodeScanModal({ isOpen, onClose }: BarcodeScanModalProps) {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const detectingRef = useRef(false)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const lastDetectionRef = useRef(0)

  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'stopped'>('stopped')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [parsed, setParsed] = useState<ParsedBarcode | null>(null)
  const [result, setResult] = useState<BarcodeLookupResult | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    detectingRef.current = false
    setCameraStatus('stopped')
    setTorchAvailable(false)
    setTorchOn(false)
  }, [])

  const lookup = useCallback(async (barcode: ParsedBarcode) => {
    if (!organisation?.id) return
    if (!hasValidGtinCheckDigit(barcode.gtin)) {
      setLookupError('The scanned GTIN check digit is invalid. Check the pack or enter the number manually.')
      return
    }

    setParsed(barcode)
    setResult(null)
    setLookupError(null)
    setLookingUp(true)
    stopCamera()
    try {
      const { data, error } = await getUserClient().functions.invoke('barcode-lookup', {
        body: { organisation_id: organisation.id, gtin: barcode.gtin },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setResult(data as BarcodeLookupResult)
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'Barcode lookup failed. Please try again.')
    } finally {
      setLookingUp(false)
    }
  }, [organisation?.id, stopCamera])

  const detectFrame = useCallback(async () => {
    const video = videoRef.current
    if (!video || !detectorRef.current || !streamRef.current) return

    const now = performance.now()
    if (!detectingRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastDetectionRef.current >= 220) {
      detectingRef.current = true
      lastDetectionRef.current = now
      try {
        const barcodes = await detectorRef.current.detect(video)
        const medicineBarcode = barcodes.find((barcode) => {
          try {
            parseMedicineBarcode(barcode.rawValue)
            return true
          } catch {
            return false
          }
        })
        if (medicineBarcode) {
          await lookup(parseMedicineBarcode(medicineBarcode.rawValue))
          return
        }
      } catch (error) {
        console.error('Barcode detection failed', error)
      } finally {
        detectingRef.current = false
      }
    }
    frameRef.current = requestAnimationFrame(detectFrame)
  }, [lookup])

  const startCamera = useCallback(async () => {
    stopCamera()
    setCameraError(null)
    setLookupError(null)
    setCameraStatus('starting')
    try {
      detectorRef.current ??= new BarcodeDetector({
        formats: ['data_matrix', 'qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
      })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('Camera preview is unavailable.')
      video.srcObject = stream
      await video.play()

      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }
      setTorchAvailable(Boolean(capabilities.torch))
      setCameraStatus('ready')
      frameRef.current = requestAnimationFrame(detectFrame)
    } catch (error) {
      stopCamera()
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access or enter the barcode manually.'
        : error instanceof Error ? error.message : 'The camera could not be started.'
      setCameraError(message)
    }
  }, [detectFrame, stopCamera])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setCameraError('The camera torch is not available on this device.')
    }
  }

  useEffect(() => {
    if (isOpen) {
      setParsed(null)
      setResult(null)
      setLookupError(null)
      setManualValue('')
      void startCamera()
    } else {
      stopCamera()
    }
    return stopCamera
  }, [isOpen, startCamera, stopCamera])

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      void lookup(parseMedicineBarcode(manualValue))
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'Enter a valid GTIN.')
    }
  }

  const resetScan = () => {
    setParsed(null)
    setResult(null)
    setLookupError(null)
    setManualValue('')
    void startCamera()
  }

  const openRegister = () => {
    const drugId = result?.catalogue_match?.id
    if (!drugId || !result?.organisation_register) return
    onClose()
    navigate(`/registers/cd/${drugId}`)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Barcode Scan" width="760px">
      {!result && !lookingUp && (
        <>
          <div className="barcode-guidance">
            <strong>Scan the medicine pack barcode</strong>
            <span>Supports EAN/GTIN, Code 128, QR and GS1 DataMatrix. No register entry will be created.</span>
          </div>

          <div className="barcode-camera">
            <video ref={videoRef} muted playsInline aria-label="Live barcode camera" />
            <div className="barcode-target" aria-hidden="true"><span /></div>
            {cameraStatus === 'starting' && <div className="barcode-camera-message">Starting camera…</div>}
            {cameraStatus === 'stopped' && !cameraError && <div className="barcode-camera-message">Camera stopped</div>}
          </div>

          <div className="barcode-camera-actions">
            {torchAvailable && (
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={toggleTorch}>
                {torchOn ? '🔦 Torch off' : '🔦 Torch on'}
              </button>
            )}
            {cameraStatus === 'stopped' && (
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => void startCamera()}>Restart camera</button>
            )}
          </div>

          {cameraError && <div className="barcode-alert barcode-alert-error" role="alert">{cameraError}</div>}
          {lookupError && <div className="barcode-alert barcode-alert-error" role="alert">{lookupError}</div>}

          <div className="barcode-divider"><span>or enter the barcode</span></div>
          <form className="barcode-manual" onSubmit={submitManual}>
            <input
              className="ps-input"
              inputMode="numeric"
              autoComplete="off"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="13 or 14 digit GTIN"
              aria-label="GTIN barcode"
            />
            <button className="ps-btn ps-btn-primary" type="submit" disabled={!manualValue.trim()}>Look up</button>
          </form>
        </>
      )}

      {lookingUp && (
        <div className="barcode-loading">
          <span className="loading-spinner" />
          <strong>Matching GTIN {parsed?.gtin} against dm+d…</strong>
        </div>
      )}

      {result && (
        <div className="barcode-result">
          {result.found ? (
            <>
              <div className={`barcode-match-heading ${result.historical ? 'is-warning' : 'is-success'}`}>
                <span>{result.historical ? '⚠️' : '✓'}</span>
                <div>
                  <strong>{result.historical ? 'Historical barcode match' : 'Medicine pack matched'}</strong>
                  <small>GTIN {result.matched_gtin ?? result.gtin}</small>
                </div>
              </div>

              <section className="barcode-result-card">
                <span className="barcode-result-label">Exact dm+d pack</span>
                <h3>{result.pack?.nm}</h3>
                {result.product?.nm && <p>{result.product.nm}</p>}
                {result.virtual_pack?.qtyval && (
                  <span className="ps-badge ps-badge-blue">Pack quantity: {result.virtual_pack.qtyval}</span>
                )}
                {result.historical && (
                  <p className="barcode-history-warning">This GTIN ended on {result.gtin_valid_to}. Confirm the physical pack before use.</p>
                )}
                {result.supplemental_mapping && (
                  <p className="barcode-supplemental-note">
                    Verified retail barcode mapping. The product is present in dm+d, but this newer GTIN is absent from the NHS GTIN feed.
                  </p>
                )}
              </section>

              {(parsed?.expiry || parsed?.batch || parsed?.serial) && (
                <section className="barcode-pack-data">
                  <h4>Data encoded on this pack</h4>
                  <dl>
                    {parsed.expiry && <><dt>Expiry</dt><dd>{new Date(`${parsed.expiry}T00:00:00Z`).toLocaleDateString('en-GB')}</dd></>}
                    {parsed.batch && <><dt>Batch</dt><dd>{parsed.batch}</dd></>}
                    {parsed.serial && <><dt>Serial</dt><dd>{parsed.serial}</dd></>}
                  </dl>
                </section>
              )}

              <section className="barcode-status-grid">
                <div className={result.catalogue_match ? 'is-success' : 'is-neutral'}>
                  <span>{result.catalogue_match ? '✓' : '—'}</span>
                  <strong>PharmStation CD catalogue</strong>
                  <small>{result.catalogue_match
                    ? `${result.catalogue_match.drug_brand} ${result.catalogue_match.drug_strength}`
                    : 'This medicine is not in the controlled-drug catalogue.'}</small>
                </div>
                <div className={result.organisation_register ? 'is-success' : 'is-neutral'}>
                  <span>{result.organisation_register ? '✓' : '—'}</span>
                  <strong>Organisation register</strong>
                  <small>{result.organisation_register
                    ? `Maintained by this organisation${result.ledger ? ` · Balance ${result.ledger.current_balance}` : ''}`
                    : result.catalogue_match ? 'No register is maintained for this drug.' : 'Not applicable.'}</small>
                </div>
              </section>

              <div className="barcode-result-actions">
                <button className="ps-btn ps-btn-ghost" onClick={resetScan}>Scan another</button>
                {result.organisation_register && result.catalogue_match && (
                  <button className="ps-btn ps-btn-primary" onClick={openRegister}>Open CD register</button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="barcode-match-heading is-warning">
                <span>?</span>
                <div><strong>No dm+d match</strong><small>GTIN {result.gtin}</small></div>
              </div>
              <div className="barcode-alert barcode-alert-warning">{result.message ?? 'This barcode was not found in dm+d.'}</div>
              <p className="barcode-unmatched-help">Check the digits, try the other barcode on the pack, or search for the drug manually in the CD register.</p>
              <div className="barcode-result-actions">
                <button className="ps-btn ps-btn-ghost" onClick={resetScan}>Try another barcode</button>
                <button className="ps-btn ps-btn-primary" onClick={() => { onClose(); navigate('/registers/cd') }}>Search CD register</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
