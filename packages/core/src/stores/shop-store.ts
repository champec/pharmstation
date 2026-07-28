// ============================================================
// Shop store — Unified Pharmacy Marketplace (Phase 1)
// Org side: settings, product CRUD/stock, order management.
// Public side: browse shops/products, cart, place order (RPC).
// ============================================================

import { create } from 'zustand'
import type {
  ShopSettings,
  ShopCategory,
  ShopProduct,
  ShopOrder,
  ShopOrderStatus,
  ShopCartItem,
  ShopPlaceOrderResult,
  ShopFulfilmentMethod,
  ShopQuestionnaire,
  ShopQuestionnaireAnswer,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

/** Public storefront listing of a pharmacy with its shop settings. */
export interface ShopFrontOrg {
  org_id: string
  name: string
  slug: string | null
  address: Record<string, string> | null
  public_logo_url: string | null
  public_description: string | null
  delivery_enabled: boolean
  delivery_radius_km: number
  delivery_fee_pence: number
  free_delivery_threshold_pence: number | null
  collection_enabled: boolean
  distance_km: number | null
}

export interface ShopState {
  // Org-side data
  settings: ShopSettings | null
  products: ShopProduct[]
  orders: ShopOrder[]
  categories: ShopCategory[]
  questionnaires: ShopQuestionnaire[]
  loading: boolean
  error: string | null

  // Public storefront data
  shopOrgs: ShopFrontOrg[]
  publicProducts: ShopProduct[]
  publicLoading: boolean
  cart: ShopCartItem[]
  cartOrgId: string | null

  // Org-side actions
  fetchSettings: (orgId: string) => Promise<void>
  saveSettings: (orgId: string, updates: Partial<ShopSettings>) => Promise<void>
  fetchCategories: () => Promise<void>
  fetchProducts: (orgId: string) => Promise<void>
  createProduct: (product: Partial<ShopProduct>) => Promise<ShopProduct>
  updateProduct: (productId: string, updates: Partial<ShopProduct>) => Promise<void>
  deleteProduct: (productId: string) => Promise<void>
  fetchOrders: (orgId: string) => Promise<void>
  updateOrderStatus: (orderId: string, status: ShopOrderStatus, orgNotes?: string) => Promise<void>
  // Questionnaires (own + public templates)
  fetchQuestionnaires: (orgId: string) => Promise<void>
  createQuestionnaire: (q: Partial<ShopQuestionnaire>) => Promise<ShopQuestionnaire>
  updateQuestionnaire: (id: string, updates: Partial<ShopQuestionnaire>) => Promise<void>
  deleteQuestionnaire: (id: string) => Promise<void>
  /** Upload a product image to the shop-products bucket; returns its public URL. */
  uploadProductImage: (orgId: string, file: File) => Promise<string>

  // Public actions
  fetchShopOrgs: (lat?: number | null, lng?: number | null) => Promise<void>
  fetchPublicProducts: (opts?: { orgId?: string; categoryId?: string; search?: string }) => Promise<void>
  addToCart: (product: ShopProduct, quantity?: number) => void
  updateCartQuantity: (productId: string, quantity: number) => void
  removeFromCart: (productId: string) => void
  clearCart: () => void
  placeOrder: (params: {
    orgId: string
    fulfilmentMethod: ShopFulfilmentMethod
    deliveryAddress?: Record<string, string> | null
    guestName?: string
    guestPhone?: string
    customerNotes?: string
    responses?: { product_id: string; questionnaire_id: string; answers: ShopQuestionnaireAnswer[] }[]
  }) => Promise<ShopPlaceOrderResult>

  clearError: () => void
}

export const useShopStore = create<ShopState>((set, get) => ({
  settings: null,
  products: [],
  orders: [],
  categories: [],
  questionnaires: [],
  loading: false,
  error: null,

  shopOrgs: [],
  publicProducts: [],
  publicLoading: false,
  cart: [],
  cartOrgId: null,

  // ---------- Org side ----------

  fetchSettings: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_settings')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      set({ settings: (data as ShopSettings) || null, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  saveSettings: async (orgId, updates) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_settings')
        .upsert({ org_id: orgId, ...updates }, { onConflict: 'org_id' })
        .select()
        .single()
      if (error) throw error
      set({ settings: data as ShopSettings, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
      throw e
    }
  },

  fetchCategories: async () => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_categories')
        .select('*')
        .order('sort_order')
      if (error) throw error
      set({ categories: data as ShopCategory[] })
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  fetchProducts: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_products')
        .select('*, category:ps_shop_categories(*), questionnaire:ps_shop_questionnaires(*)')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      set({ products: data as ShopProduct[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createProduct: async (product) => {
    const { data, error } = await getUserClient()
      .from('ps_shop_products')
      .insert(product)
      .select('*, category:ps_shop_categories(*)')
      .single()
    if (error) throw error
    set({ products: [...get().products, data as ShopProduct].sort((a, b) => a.name.localeCompare(b.name)) })
    return data as ShopProduct
  },

  updateProduct: async (productId, updates) => {
    const { data, error } = await getUserClient()
      .from('ps_shop_products')
      .update(updates)
      .eq('id', productId)
      .select('*, category:ps_shop_categories(*)')
      .single()
    if (error) throw error
    set({ products: get().products.map((p) => (p.id === productId ? (data as ShopProduct) : p)) })
  },

  deleteProduct: async (productId) => {
    const { error } = await getUserClient().from('ps_shop_products').delete().eq('id', productId)
    if (error) throw error
    set({ products: get().products.filter((p) => p.id !== productId) })
  },

  fetchOrders: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_orders')
        .select('*, items:ps_shop_order_items(*), responses:ps_shop_questionnaire_responses(*)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ orders: data as ShopOrder[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  updateOrderStatus: async (orderId, status, orgNotes) => {
    const updates: Record<string, unknown> = { status }
    if (orgNotes !== undefined) updates.org_notes = orgNotes
    const { data, error } = await getUserClient()
      .from('ps_shop_orders')
      .update(updates)
      .eq('id', orderId)
      .select('*, items:ps_shop_order_items(*), responses:ps_shop_questionnaire_responses(*)')
      .single()
    if (error) throw error
    set({ orders: get().orders.map((o) => (o.id === orderId ? (data as ShopOrder) : o)) })
  },

  fetchQuestionnaires: async (orgId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_shop_questionnaires')
        .select('*')
        .or(`org_id.is.null,org_id.eq.${orgId}`)
        .order('name')
      if (error) throw error
      set({ questionnaires: data as ShopQuestionnaire[] })
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  createQuestionnaire: async (q) => {
    const { data, error } = await getUserClient()
      .from('ps_shop_questionnaires')
      .insert(q)
      .select()
      .single()
    if (error) throw error
    set({ questionnaires: [...get().questionnaires, data as ShopQuestionnaire].sort((a, b) => a.name.localeCompare(b.name)) })
    return data as ShopQuestionnaire
  },

  updateQuestionnaire: async (id, updates) => {
    const { data, error } = await getUserClient()
      .from('ps_shop_questionnaires')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    set({ questionnaires: get().questionnaires.map((q) => (q.id === id ? (data as ShopQuestionnaire) : q)) })
  },

  deleteQuestionnaire: async (id) => {
    const { error } = await getUserClient().from('ps_shop_questionnaires').delete().eq('id', id)
    if (error) throw error
    set({ questionnaires: get().questionnaires.filter((q) => q.id !== id) })
  },

  uploadProductImage: async (orgId, file) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const client = getUserClient()
    const { error } = await client.storage.from('shop-products').upload(path, file, { upsert: false })
    if (error) throw error
    const { data } = client.storage.from('shop-products').getPublicUrl(path)
    return data.publicUrl
  },

  // ---------- Public storefront ----------

  fetchShopOrgs: async (lat = null, lng = null) => {
    set({ publicLoading: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_shop_list_orgs', {
        p_lat: lat,
        p_lng: lng,
      })
      if (error) throw error
      set({ shopOrgs: (data as ShopFrontOrg[]) || [], publicLoading: false })
    } catch (e: any) {
      set({ error: e.message, publicLoading: false })
    }
  },

  fetchPublicProducts: async (opts = {}) => {
    set({ publicLoading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_shop_products')
        .select('*, category:ps_shop_categories(*), questionnaire:ps_shop_questionnaires(*), organisation:ps_organisations(id, name, address, slug, public_logo_url)')
        .eq('is_active', true)
        .order('name')
      if (opts.orgId) query = query.eq('org_id', opts.orgId)
      if (opts.categoryId) query = query.eq('category_id', opts.categoryId)
      if (opts.search) query = query.ilike('name', `%${opts.search}%`)
      const { data, error } = await query
      if (error) throw error
      set({ publicProducts: data as ShopProduct[], publicLoading: false })
    } catch (e: any) {
      set({ error: e.message, publicLoading: false })
    }
  },

  addToCart: (product, quantity = 1) => {
    const { cart, cartOrgId } = get()
    // Phase 1: single-pharmacy cart. Switching pharmacy resets the cart.
    if (cartOrgId && cartOrgId !== product.org_id) {
      set({ cart: [{ product, quantity }], cartOrgId: product.org_id })
      return
    }
    const existing = cart.find((c) => c.product.id === product.id)
    if (existing) {
      set({
        cart: cart.map((c) =>
          c.product.id === product.id ? { ...c, quantity: c.quantity + quantity } : c
        ),
      })
    } else {
      set({ cart: [...cart, { product, quantity }], cartOrgId: product.org_id })
    }
  },

  updateCartQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(productId)
      return
    }
    set({ cart: get().cart.map((c) => (c.product.id === productId ? { ...c, quantity } : c)) })
  },

  removeFromCart: (productId) => {
    const next = get().cart.filter((c) => c.product.id !== productId)
    set({ cart: next, cartOrgId: next.length ? get().cartOrgId : null })
  },

  clearCart: () => set({ cart: [], cartOrgId: null }),

  placeOrder: async (params) => {
    const { cart } = get()
    if (!cart.length) throw new Error('Cart is empty')
    const { data, error } = await getUserClient().rpc('ps_shop_place_order', {
      p_org_id: params.orgId,
      p_items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      p_fulfilment_method: params.fulfilmentMethod,
      p_delivery_address: params.deliveryAddress ?? null,
      p_guest_name: params.guestName ?? null,
      p_guest_phone: params.guestPhone ?? null,
      p_customer_notes: params.customerNotes ?? null,
      p_responses: params.responses?.length ? params.responses : null,
    })
    if (error) throw error
    get().clearCart()
    return data as ShopPlaceOrderResult
  },

  clearError: () => set({ error: null }),
}))
