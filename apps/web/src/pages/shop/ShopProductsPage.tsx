// ============================================================
// ShopProductsPage — /shop-admin
// Org-side: shop enable/settings + product & stock management.
// Phase 1 of the Shop marketplace (see documentation/shop).
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Settings, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore, useShopStore } from '@pharmstation/core'
import type { ShopProduct, ShopMedicineClass, ShopPaymentMethods } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

export function ShopProductsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    settings, products, categories, questionnaires, loading, error,
    fetchSettings, saveSettings, fetchCategories, fetchProducts, fetchQuestionnaires,
    createProduct, updateProduct, deleteProduct, uploadProductImage, clearError,
  } = useShopStore()

  const [showProductModal, setShowProductModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [editing, setEditing] = useState<ShopProduct | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Product form state
  const [fName, setFName] = useState('')
  const [fDescription, setFDescription] = useState('')
  const [fPrice, setFPrice] = useState('')
  const [fStock, setFStock] = useState('0')
  const [fSku, setFSku] = useState('')
  const [fCategoryId, setFCategoryId] = useState('')
  const [fImageUrl, setFImageUrl] = useState('')
  const [fActive, setFActive] = useState(true)
  const [fCheckAvailability, setFCheckAvailability] = useState(false)
  const [fQuestionnaireId, setFQuestionnaireId] = useState('')
  const [fMedicineClass, setFMedicineClass] = useState<ShopMedicineClass>('general')
  const [fMaxPerOrder, setFMaxPerOrder] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Settings form state
  const [sEnabled, setSEnabled] = useState(false)
  const [sDelivery, setSDelivery] = useState(false)
  const [sRadius, setSRadius] = useState('5')
  const [sFee, setSFee] = useState('0')
  const [sFreeOver, setSFreeOver] = useState('')
  const [sPayment, setSPayment] = useState<ShopPaymentMethods>('in_store')
  const [cardReady, setCardReady] = useState<boolean | null>(null)
  const [sPicName, setSPicName] = useState('')
  const [sPicGphc, setSPicGphc] = useState('')
  const [sPhone, setSPhone] = useState('')
  const [sEmail, setSEmail] = useState('')
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchSettings(organisation.id)
      fetchProducts(organisation.id)
      fetchCategories()
      fetchQuestionnaires(organisation.id)
    }
  }, [organisation?.id, fetchSettings, fetchProducts, fetchCategories, fetchQuestionnaires])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setFName(''); setFDescription(''); setFPrice(''); setFStock('0'); setFSku('')
    setFCategoryId(''); setFImageUrl(''); setFActive(true); setFCheckAvailability(false)
    setFQuestionnaireId('')
    setFMedicineClass('general'); setFMaxPerOrder('')
    setModalError(null)
    setShowProductModal(true)
  }

  const openEdit = (p: ShopProduct) => {
    setEditing(p)
    setFName(p.name); setFDescription(p.description || '')
    setFPrice((p.price_pence / 100).toFixed(2)); setFStock(String(p.stock_quantity))
    setFSku(p.sku || ''); setFCategoryId(p.category_id || ''); setFImageUrl(p.image_url || '')
    setFActive(p.is_active); setFCheckAvailability(p.requires_availability_check)
    setFQuestionnaireId(p.questionnaire_id || '')
    setFMedicineClass(p.medicine_class || 'general')
    setFMaxPerOrder(p.max_per_order ? String(p.max_per_order) : '')
    setModalError(null)
    setShowProductModal(true)
  }

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !organisation?.id) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setModalError('Please choose a JPEG, PNG, WebP or GIF image'); return
    }
    if (file.size > 5 * 1024 * 1024) { setModalError('Image must be under 5 MB'); return }
    setUploadingImage(true); setModalError(null)
    try {
      const url = await uploadProductImage(organisation.id, file)
      setFImageUrl(url)
    } catch (e: any) {
      setModalError(`Image upload failed: ${e.message}`)
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSaveProduct = async () => {
    if (!organisation?.id || !fName.trim()) return
    const pricePence = Math.round(parseFloat(fPrice || '0') * 100)
    if (isNaN(pricePence) || pricePence < 0) { setModalError('Enter a valid price'); return }
    if (fMedicineClass === 'p' && !fQuestionnaireId) {
      setModalError('A pharmacy (P) medicine needs a consultation questionnaire, so a pharmacist can check each sale.'); return
    }
    const maxPerOrder = fMaxPerOrder.trim() ? parseInt(fMaxPerOrder, 10) : null
    if (maxPerOrder !== null && (isNaN(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 50)) {
      setModalError('Max per order must be between 1 and 50, or left blank'); return
    }
    setSaving(true); setModalError(null)
    try {
      const payload = {
        name: fName.trim(),
        description: fDescription.trim() || null,
        price_pence: pricePence,
        stock_quantity: Math.max(0, parseInt(fStock || '0', 10) || 0),
        sku: fSku.trim() || null,
        category_id: fCategoryId || null,
        image_url: fImageUrl.trim() || null,
        is_active: fActive,
        requires_availability_check: fCheckAvailability,
        questionnaire_id: fQuestionnaireId || null,
        requires_consultation: !!fQuestionnaireId,
        medicine_class: fMedicineClass,
        max_per_order: maxPerOrder,
      }
      if (editing) {
        await updateProduct(editing.id, payload)
      } else {
        await createProduct({ ...payload, org_id: organisation.id })
      }
      setShowProductModal(false)
    } catch (e: any) {
      setModalError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: ShopProduct) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    try { await deleteProduct(p.id) } catch (e: any) { setModalError(e.message) }
  }

  const openSettings = () => {
    setSEnabled(settings?.shop_enabled ?? false)
    setSDelivery(settings?.delivery_enabled ?? false)
    setSRadius(String(settings?.delivery_radius_km ?? 5))
    setSFee(((settings?.delivery_fee_pence ?? 0) / 100).toFixed(2))
    setSFreeOver(settings?.free_delivery_threshold_pence != null ? (settings.free_delivery_threshold_pence / 100).toFixed(2) : '')
    setSPayment(settings?.payment_methods ?? 'in_store')
    setSPicName(settings?.pharmacist_in_charge_name ?? '')
    setSPicGphc(settings?.pharmacist_in_charge_gphc ?? '')
    setSPhone(settings?.contact_phone ?? '')
    setSEmail(settings?.contact_email ?? '')
    setSettingsError(null)
    setCardReady(null)
    if (organisation?.id) useShopStore.getState().fetchCardReady(organisation.id).then(setCardReady)
    setShowSettingsModal(true)
  }

  const handleSaveSettings = async () => {
    if (!organisation?.id) return
    setSaving(true)
    setSettingsError(null)
    try {
      await saveSettings(organisation.id, {
        shop_enabled: sEnabled,
        delivery_enabled: sDelivery,
        delivery_radius_km: parseFloat(sRadius || '5') || 5,
        delivery_fee_pence: Math.round(parseFloat(sFee || '0') * 100) || 0,
        free_delivery_threshold_pence: sFreeOver.trim() ? Math.round(parseFloat(sFreeOver) * 100) : null,
        payment_methods: sPayment,
        // Only send the shop-front details once the database has them, so
        // saving still works while the migration is being rolled out.
        ...((settings && 'pharmacist_in_charge_name' in settings) || sPicName.trim() || sPicGphc.trim() || sPhone.trim() || sEmail.trim()
          ? {
              pharmacist_in_charge_name: sPicName.trim() || null,
              pharmacist_in_charge_gphc: sPicGphc.replace(/\s/g, '') || null,
              contact_phone: sPhone.trim() || null,
              contact_email: sEmail.trim() || null,
            }
          : {}),
      })
      setShowSettingsModal(false)
    } catch (e: any) {
      setSettingsError(e?.message || 'Could not save the settings')
      useShopStore.getState().clearError()
    } finally {
      setSaving(false)
    }
  }

  const filtered = products.filter((p) => {
    const q = search.toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
  })

  const isPharmacy = (organisation as any)?.organisation_type !== 'care_home'

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Shop' }]}
        title="Products and stock"
        subtitle="What you sell in your online shop, with prices and stock."
        actions={<>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/shop-admin/orders')}>Orders</button>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/shop-admin/questionnaires')}>Questionnaires</button>
          <button className="ps-btn ps-btn-secondary" onClick={openSettings}><Settings size={16} strokeWidth={1.75} aria-hidden="true" /> Shop settings</button>
          <button className="ps-btn ps-btn-primary" onClick={openCreate}>+ Add product</button>
        </>}
      />

      {!isPharmacy && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', borderLeft: '4px solid var(--ps-warning, #f59e0b)' }}>
          The shop marketplace is available to pharmacy organisations only.
        </div>
      )}

      {error && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', color: 'var(--ps-error, #dc2626)' }}>
          {error} <button className="ps-btn ps-btn-secondary" onClick={clearError} style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      )}

      {/* Shop status banner */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
        <div>
          <strong>Shop status:</strong>{' '}
          {settings?.shop_enabled
            ? <span style={{ color: 'var(--ps-success)' }}>● Live on the marketplace</span>
            : <span style={{ color: 'var(--ps-slate)' }}>○ Not published</span>}
          {settings?.shop_enabled && (
            <span style={{ marginLeft: 12, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
              {settings.delivery_enabled ? `Delivery within ${settings.delivery_radius_km} km` : 'Collection only'}
            </span>
          )}
        </div>
        <button className="ps-btn ps-btn-secondary" onClick={() => window.open(`/shop/${(organisation as { slug?: string | null } | null)?.slug || organisation?.id || ''}`, '_blank')}>View your shop →</button>
      </div>

      <div style={{ marginBottom: 'var(--ps-space-md)' }}>
        <input
          className="ps-input"
          placeholder="Search products by name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 420 }}
        />
      </div>

      {loading && <p style={{ color: 'var(--ps-slate)' }}>Loading…</p>}

      {!loading && filtered.length === 0 && (
        search ? (
          <EmptyState icon={Package} title="No products match your search" actions={<button className="ps-btn ps-btn-secondary" onClick={() => setSearch('')}>Clear search</button>}>
            Try a different name or SKU.
          </EmptyState>
        ) : (
          <EmptyState icon={Package} title="No products yet" actions={<button className="ps-btn ps-btn-primary" onClick={openCreate}>+ Add product</button>}>
            Add your first product to start selling online.
          </EmptyState>
        )
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
        {filtered.map((p) => (
          <div key={p.id} className="ps-card" style={{ padding: 'var(--ps-space-md)', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ps-slate)' }}><Package size={22} strokeWidth={1.75} aria-hidden="true" /></div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{p.name}</strong>
                {!p.is_active && <span className="ps-badge" style={{ background: 'var(--ps-off-white)', color: 'var(--ps-slate)' }}>Hidden</span>}
                {p.requires_availability_check && <span className="ps-badge" style={{ background: '#fef3c7', color: '#92400e' }}>Check availability</span>}
                {p.medicine_class === 'p' && <span className="ps-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>P medicine</span>}
                {p.medicine_class === 'gsl' && <span className="ps-badge" style={{ background: '#e0f2fe', color: '#075985' }}>GSL</span>}
                {p.max_per_order && <span className="ps-badge">Max {p.max_per_order}</span>}
                {p.questionnaire_id && <span className="ps-badge" style={{ background: '#ede9fe', color: '#5b21b6' }}>Consultation</span>}
              </div>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                {p.category?.name || 'Uncategorised'}{p.sku ? ` · SKU ${p.sku}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>{formatPrice(p.price_pence)}</div>
              <div style={{ fontSize: 'var(--ps-font-sm)', color: p.stock_quantity === 0 ? 'var(--ps-error, #dc2626)' : p.stock_quantity <= 5 ? '#d97706' : 'var(--ps-slate)' }}>
                {p.stock_quantity === 0 ? 'Out of stock' : `${p.stock_quantity} in stock`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-xs)' }}>
              <button className="ps-btn ps-btn-secondary" onClick={() => openEdit(p)}>Edit</button>
              <button className="ps-btn ps-btn-secondary" onClick={() => handleDelete(p)} aria-label={`Delete ${p.name}`} title="Delete"><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Product modal */}
      <Modal isOpen={showProductModal} onClose={() => setShowProductModal(false)} title={editing ? 'Edit product' : 'New product'}>
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          {modalError && <div style={{ color: 'var(--ps-error, #dc2626)' }}>{modalError}</div>}
          <label>
            Name *
            <input className="ps-input" value={fName} onChange={(e) => setFName(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            Description
            <textarea className="ps-input" value={fDescription} onChange={(e) => setFDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <label>
              Price (£) *
              <input className="ps-input" type="number" min="0" step="0.01" value={fPrice} onChange={(e) => setFPrice(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label>
              Stock
              <input className="ps-input" type="number" min="0" value={fStock} onChange={(e) => setFStock(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label>
              SKU / Barcode
              <input className="ps-input" value={fSku} onChange={(e) => setFSku(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <label>
            Category
            <select className="ps-input" value={fCategoryId} onChange={(e) => setFCategoryId(e.target.value)} style={{ width: '100%' }}>
              <option value="">Uncategorised</option>
              {categories.filter((c) => !c.parent_id).map((parent) => (
                <optgroup key={parent.id} label={parent.name}>
                  <option value={parent.id}>{parent.name} (general)</option>
                  {categories.filter((c) => c.parent_id === parent.id).map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Product image
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginTop: 4 }}>
              {fImageUrl ? (
                <img src={fImageUrl} alt="Product" style={{ width: 56, height: 56, borderRadius: 'var(--ps-radius-md)', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>📦</div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={(e) => handleImageFile(e.target.files?.[0])}
              />
              <button className="ps-btn ps-btn-secondary" disabled={uploadingImage} onClick={() => fileInputRef.current?.click()}>
                {uploadingImage ? 'Uploading…' : fImageUrl ? 'Replace image' : 'Upload image'}
              </button>
              {fImageUrl && (
                <button className="ps-btn ps-btn-secondary" onClick={() => setFImageUrl('')}>Remove</button>
              )}
            </div>
            <input
              className="ps-input"
              value={fImageUrl}
              onChange={(e) => setFImageUrl(e.target.value)}
              placeholder="…or paste an image URL"
              style={{ width: '100%', marginTop: 8 }}
            />
          </label>
          <label>
            Product type
            <select className="ps-input" value={fMedicineClass} onChange={(e) => setFMedicineClass(e.target.value as ShopMedicineClass)} style={{ width: '100%' }}>
              <option value="general">Not a medicine</option>
              <option value="gsl">General sale medicine (GSL)</option>
              <option value="p">Pharmacy medicine (P), needs a pharmacist check</option>
            </select>
            <span style={{ display: 'block', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
              Prescription-only medicines (POMs) can't be sold in the shop. P medicine orders wait for a pharmacist to approve them before they can be confirmed.
            </span>
          </label>
          <label>
            Max per order
            <input className="ps-input" type="number" min={1} max={50} value={fMaxPerOrder} onChange={(e) => setFMaxPerOrder(e.target.value)} placeholder="No limit" style={{ width: '100%' }} />
            <span style={{ display: 'block', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
              Optional, for example 2 packs of paracetamol.
            </span>
          </label>
          <label>
            Consultation questionnaire{fMedicineClass === 'p' ? ' *' : ''}
            <select className="ps-input" value={fQuestionnaireId} onChange={(e) => setFQuestionnaireId(e.target.value)} style={{ width: '100%' }}>
              <option value="">None — no questions required</option>
              {questionnaires.filter((q) => q.is_active).map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}{q.org_id === null ? ' (public template)' : ''}
                </option>
              ))}
            </select>
            <span style={{ display: 'block', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
              Customers must answer these questions before checkout (for P meds, EHC, etc.).{' '}
              <a href="/shop-admin/questionnaires" onClick={(e) => { e.preventDefault(); navigate('/shop-admin/questionnaires') }}>Manage questionnaires →</a>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} />
            Visible on the marketplace
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={fCheckAvailability} onChange={(e) => setFCheckAvailability(e.target.checked)} />
            Check availability before purchase (you confirm each order before the customer pays)
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowProductModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={saving || !fName.trim()} onClick={handleSaveProduct}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Settings modal */}
      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Shop settings">
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sEnabled} onChange={(e) => setSEnabled(e.target.checked)} />
            <strong>Publish shop on the marketplace</strong>
          </label>
          <p style={{ margin: 0, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            Your organisation must also be public (Settings → Public Booking) for customers to find your shop.
          </p>
          {settingsError && (
            <div role="alert" style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--ps-font-sm)' }}>{settingsError}</div>
          )}
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)' }} />
          <div>
            <strong>Shown to customers</strong>
            <p style={{ margin: '2px 0 8px', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
              The law requires online pharmacies to show who is responsible for selling medicines. Your shop can't open without these.
              Your GPhC premises number comes from Settings{organisation?.gphc_premises_number ? ` (currently ${organisation.gphc_premises_number})` : ' and is not set yet'}.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--ps-space-md)' }}>
              <label>
                Pharmacist in charge
                <input className="ps-input" value={sPicName} onChange={(e) => setSPicName(e.target.value)} placeholder="Full name" autoComplete="off" style={{ width: '100%' }} />
              </label>
              <label>
                Their GPhC number
                <input className="ps-input" value={sPicGphc} onChange={(e) => setSPicGphc(e.target.value)} placeholder="7 digits" inputMode="numeric" maxLength={9} style={{ width: '100%' }} />
              </label>
              <label>
                Customer phone
                <input className="ps-input" type="tel" value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="Pharmacy phone" style={{ width: '100%' }} />
              </label>
              <label>
                Customer email
                <input className="ps-input" type="email" value={sEmail} onChange={(e) => setSEmail(e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
              </label>
            </div>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sDelivery} onChange={(e) => setSDelivery(e.target.checked)} />
            Offer delivery
          </label>
          {sDelivery && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--ps-space-md)' }}>
              <label>
                Radius (km)
                <input className="ps-input" type="number" min="0.5" step="0.5" value={sRadius} onChange={(e) => setSRadius(e.target.value)} style={{ width: '100%' }} />
              </label>
              <label>
                Delivery fee (£)
                <input className="ps-input" type="number" min="0" step="0.01" value={sFee} onChange={(e) => setSFee(e.target.value)} style={{ width: '100%' }} />
              </label>
              <label>
                Free over (£)
                <input className="ps-input" type="number" min="0" step="0.01" value={sFreeOver} onChange={(e) => setSFreeOver(e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
              </label>
            </div>
          )}
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)' }} />
          <label>
            How customers pay
            <select className="ps-input" value={sPayment} onChange={(e) => setSPayment(e.target.value as ShopPaymentMethods)} style={{ width: '100%' }}>
              <option value="in_store">In store or on delivery</option>
              <option value="card">Card online at checkout</option>
              <option value="both">Customer chooses: card online, or in store / on delivery</option>
            </select>
            <span style={{ display: 'block', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
              Card payments go straight to your pharmacy's bank account through Stripe. Cancelling a paid order, or a pharmacist rejecting it, refunds the customer automatically.
            </span>
            {sPayment !== 'in_store' && cardReady === false && (
              <span style={{ display: 'block', color: '#b45309', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
                Card payments aren't set up yet, so customers will only see pay in store until you finish Stripe setup on the{' '}
                <a href="/payments" onClick={(e) => { e.preventDefault(); navigate('/payments') }}>Payments page</a>.
              </span>
            )}
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={saving} onClick={handleSaveSettings}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
