// ============================================================
// ShopProductsPage — /shop-admin
// Org-side: shop enable/settings + product & stock management.
// Phase 1 of the Shop marketplace (see documentation/shop).
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useShopStore } from '@pharmstation/core'
import type { ShopProduct } from '@pharmstation/types'
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
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Settings form state
  const [sEnabled, setSEnabled] = useState(false)
  const [sDelivery, setSDelivery] = useState(false)
  const [sRadius, setSRadius] = useState('5')
  const [sFee, setSFee] = useState('0')
  const [sFreeOver, setSFreeOver] = useState('')

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
    setModalError(null)
    setShowProductModal(true)
  }

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !organisation?.id) return
    if (!file.type.startsWith('image/')) { setModalError('Please choose an image file'); return }
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
    setShowSettingsModal(true)
  }

  const handleSaveSettings = async () => {
    if (!organisation?.id) return
    setSaving(true)
    try {
      await saveSettings(organisation.id, {
        shop_enabled: sEnabled,
        delivery_enabled: sDelivery,
        delivery_radius_km: parseFloat(sRadius || '5') || 5,
        delivery_fee_pence: Math.round(parseFloat(sFee || '0') * 100) || 0,
        free_delivery_threshold_pence: sFreeOver.trim() ? Math.round(parseFloat(sFreeOver) * 100) : null,
      })
      setShowSettingsModal(false)
    } catch { /* error shown via store */ } finally {
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
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Shop</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>🛍️ Shop — Products & Inventory</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/shop-admin/orders')}>📦 Orders</button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/shop-admin/questionnaires')}>📝 Questionnaires</button>
            <button className="ps-btn ps-btn-secondary" onClick={openSettings}>⚙️ Shop Settings</button>
            <button className="ps-btn ps-btn-primary" onClick={openCreate}>+ New Product</button>
          </div>
        </div>
      </div>

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
            ? <span style={{ color: 'var(--ps-success, #16a34a)' }}>● Live on the marketplace</span>
            : <span style={{ color: 'var(--ps-slate)' }}>○ Not published</span>}
          {settings?.shop_enabled && (
            <span style={{ marginLeft: 12, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
              {settings.delivery_enabled ? `🚚 Delivery within ${settings.delivery_radius_km} km` : 'Collection only'}
            </span>
          )}
        </div>
        <button className="ps-btn ps-btn-secondary" onClick={() => window.open('/shop', '_blank')}>View marketplace →</button>
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
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          {search ? 'No products match your search.' : 'No products yet. Add your first product to start selling.'}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
        {filtered.map((p) => (
          <div key={p.id} className="ps-card" style={{ padding: 'var(--ps-space-md)', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>📦</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{p.name}</strong>
                {!p.is_active && <span className="ps-badge" style={{ background: 'var(--ps-off-white)', color: 'var(--ps-slate)' }}>Hidden</span>}
                {p.requires_availability_check && <span className="ps-badge" style={{ background: '#fef3c7', color: '#92400e' }}>Check availability</span>}
                {p.questionnaire_id && <span className="ps-badge" style={{ background: '#ede9fe', color: '#5b21b6' }}>📝 Consultation</span>}
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
              <button className="ps-btn ps-btn-secondary" onClick={() => handleDelete(p)}>🗑️</button>
            </div>
          </div>
        ))}
      </div>

      {/* Product modal */}
      <Modal isOpen={showProductModal} onClose={() => setShowProductModal(false)} title={editing ? 'Edit Product' : 'New Product'}>
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
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleImageFile(e.target.files?.[0])}
              />
              <button className="ps-btn ps-btn-secondary" disabled={uploadingImage} onClick={() => fileInputRef.current?.click()}>
                {uploadingImage ? 'Uploading…' : fImageUrl ? '📷 Replace image' : '📷 Upload image'}
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
            Consultation questionnaire
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
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Settings modal */}
      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Shop Settings">
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sEnabled} onChange={(e) => setSEnabled(e.target.checked)} />
            <strong>Publish shop on the marketplace</strong>
          </label>
          <p style={{ margin: 0, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            Your organisation must also be public (Settings → Public Booking) for customers to find your shop.
          </p>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={saving} onClick={handleSaveSettings}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
