import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function normalisePhone(raw: string) {
  let value = raw.replace(/[^\d+]/g, '')
  if (value.startsWith('+')) value = value.slice(1)
  else if (value.startsWith('00')) value = value.slice(2)
  else if (value.startsWith('0')) value = `44${value.slice(1)}`
  else if (value.startsWith('7') && value.length === 10) value = `44${value}`
  if (!/^\d{8,15}$/.test(value)) throw new Error(`Invalid phone number: ${raw}`)
  return value
}

function isUkMobile(value: string) {
  try { return /^447\d{9}$/.test(normalisePhone(value)) } catch { return false }
}

function normaliseEmail(value: string) {
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function parseContacts(raw: unknown): Array<{ ContactMethodType?: string; ContactValue?: string }> {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

type DirectoryRecipient = {
  id: number
  ods_code: string
  organisation_name: string
  city: string | null
  postcode: string | null
  email: string
}

function directoryExclusionTerms(raw: unknown) {
  return String(raw || '').split(',').map((term) => term.trim().toLowerCase()).filter(Boolean).slice(0, 20)
}

async function findDirectoryRecipients(body: Record<string, unknown>, maxResults: number) {
  const admin = adminClient()
  const orgId = String(body.org_id || '')
  const search = String(body.search || '').trim()
  const area = String(body.area || '').trim()
  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)
  const radiusKm = Math.min(100, Math.max(1, Number(body.radius_km) || 15))
  const page = Math.max(0, Number(body.page) || 0)
  // Email campaigns can contain up to 500 recipients, so allow an operator
  // to review and select a full campaign-sized directory page at once.
  const pageSize = Math.min(500, Math.max(10, Number(body.page_size) || 100))
  const exclusions = directoryExclusionTerms(body.exclude_terms)
  const safeSearch = search.replace(/[%(),]/g, '')
  const safeArea = area.replace(/[%(),]/g, '')
  let pharmacies: Array<Record<string, unknown>> = []

  // The map is the source of truth for location-based pharmacy discovery.
  // Reuse its RPC here instead of relying on a separate table filter with a
  // different definition of an active/searchable pharmacy.
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const latDelta = radiusKm / 111
    const lngDelta = radiusKm / Math.max(1, 111 * Math.cos(latitude * Math.PI / 180))
    const { data, error } = await admin.rpc('get_pharmacies_in_bounds', {
      p_min_lat: latitude - latDelta,
      p_max_lat: latitude + latDelta,
      p_min_lng: longitude - lngDelta,
      p_max_lng: longitude + lngDelta,
      p_org_id: orgId || null,
    })
    if (error) throw new Error(error.message)
    pharmacies = (data || []) as Array<Record<string, unknown>>
  } else {
    let query = admin.from('pharmacies').select('id, ods_code, organisation_name, city, postcode, contacts')
    if (safeSearch) query = query.or(`organisation_name.ilike.%${safeSearch}%,ods_code.ilike.%${safeSearch}%,postcode.ilike.%${safeSearch}%,city.ilike.%${safeSearch}%`)
    if (safeArea) query = query.or(`city.ilike.%${safeArea}%,postcode.ilike.%${safeArea}%`)
    const { data, error } = await query.order('organisation_name').limit(maxResults)
    if (error) throw new Error(error.message)
    pharmacies = (data || []) as Array<Record<string, unknown>>
  }

  const matchingPharmacies = pharmacies.filter((pharmacy) => {
    const searchable = [pharmacy.organisation_name, pharmacy.ods_code, pharmacy.postcode, pharmacy.city].join(' ').toLowerCase()
    return (!safeSearch || searchable.includes(safeSearch.toLowerCase())) && (!safeArea || searchable.includes(safeArea.toLowerCase()))
  })
  const recipients = matchingPharmacies.flatMap((pharmacy) => {
    const email = parseContacts(pharmacy.contacts).find((item) => item.ContactMethodType === 'Email')?.ContactValue?.trim().toLowerCase()
    const name = String(pharmacy.organisation_name || '').toLowerCase()
    return email && !exclusions.some((term) => name.includes(term))
      ? [{ id: Number(pharmacy.pharmacy_id ?? pharmacy.id), ods_code: String(pharmacy.ods_code || ''), organisation_name: String(pharmacy.organisation_name || ''), city: pharmacy.city as string | null, postcode: pharmacy.postcode as string | null, email }]
      : []
  })
  const start = page * pageSize
  return {
    recipients: recipients.slice(start, start + pageSize) as DirectoryRecipient[],
    total: recipients.length,
    page,
    page_size: pageSize,
    source_count: matchingPharmacies.length,
    scanned_count: pharmacies.length,
    is_truncated: pharmacies.length >= maxResults,
  }
}

async function listEmailRecipients(body: Record<string, unknown>) {
  return findDirectoryRecipients(body, 5000)
}

async function importDirectoryEmailContacts(body: Record<string, unknown>, userId: string) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const pharmacyIds = Array.isArray(body.pharmacy_ids) ? body.pharmacy_ids.map(Number).filter(Number.isFinite) : []
  const selectedRecipients = Array.isArray(body.selected_recipients) ? body.selected_recipients : []
  const importAll = Boolean(body.import_all)
  if (!importAll && !pharmacyIds.length && !selectedRecipients.length) throw new Error('Select one or more pharmacies to add')

  let candidates: DirectoryRecipient[]
  if (importAll) {
    const result = await findDirectoryRecipients({ ...body, page: 0, page_size: 500 }, 5000)
    candidates = result.recipients
    // The first page contains 500 after the helper's filtering/pagination.
    if (result.total > 500) throw new Error('This search has more than 500 email addresses. Narrow the area or add an exclusion before importing.')
  } else if (selectedRecipients.length) {
    // The browser has already received and displayed these email-bearing
    // directory rows. Reuse that exact selection so Add selected cannot fail
    // due to a second query taking a different path from the map RPC.
    candidates = selectedRecipients.flatMap((recipient) => {
      const id = Number((recipient as Record<string, unknown>).id)
      const email = normaliseEmail(String((recipient as Record<string, unknown>).email || ''))
      const name = String((recipient as Record<string, unknown>).organisation_name || '').trim()
      return Number.isFinite(id) && email && name ? [{
        id,
        ods_code: String((recipient as Record<string, unknown>).ods_code || ''),
        organisation_name: name,
        city: (recipient as Record<string, unknown>).city as string | null,
        postcode: (recipient as Record<string, unknown>).postcode as string | null,
        email,
      }] : []
    })
  } else {
    const { data, error } = await admin.from('pharmacies')
      .select('id, ods_code, organisation_name, city, postcode, contacts')
      .in('id', pharmacyIds.slice(0, 500))
    if (error) throw new Error(error.message)
    const exclusions = directoryExclusionTerms(body.exclude_terms)
    candidates = (data || []).flatMap((pharmacy) => {
      const email = parseContacts(pharmacy.contacts).find((item) => item.ContactMethodType === 'Email')?.ContactValue?.trim().toLowerCase()
      return email && !exclusions.some((term) => String(pharmacy.organisation_name || '').toLowerCase().includes(term))
        ? [{ id: pharmacy.id, ods_code: pharmacy.ods_code, organisation_name: pharmacy.organisation_name, city: pharmacy.city, postcode: pharmacy.postcode, email }]
        : []
    })
  }
  if (!candidates.length) throw new Error('No eligible email addresses matched the selected pharmacies')

  const candidatesByEmail = new Map(candidates.map((candidate) => [candidate.email, candidate]))
  candidates = [...candidatesByEmail.values()]
  const emails = [...candidatesByEmail.keys()]
  const { data: existing, error: existingError } = await admin.from('ps_marketing_contacts')
    .select('*').eq('org_id', orgId).in('email_normalized', emails)
  if (existingError) throw new Error(existingError.message)
  const existingByEmail = new Map((existing || []).map((contact) => [contact.email_normalized, contact]))
  const newContacts = candidates.filter((candidate) => !existingByEmail.has(candidate.email)).map((candidate) => ({
    org_id: orgId,
    name: candidate.organisation_name,
    organisation_name: candidate.organisation_name,
    field: 'Pharmacy',
    email: candidate.email,
    email_normalized: candidate.email,
    email_eligible: true,
    sms_eligible: false,
    notes: [candidate.ods_code && `NHS ODS: ${candidate.ods_code}`, candidate.city, candidate.postcode].filter(Boolean).join(' · '),
    tags: ['nhs-directory'],
    status: 'active',
    source_type: 'nhs_directory',
    created_by: userId,
  }))
  let inserted: unknown[] = []
  if (newContacts.length) {
    const { data, error } = await admin.from('ps_marketing_contacts').insert(newContacts).select('*')
    if (error) throw new Error(error.message)
    inserted = data || []
  }
  const contacts = [...(existing || []), ...inserted]
  return { contacts, added: inserted.length, existing: (existing || []).length, total: contacts.length }
}

async function listContacts(body: Record<string, unknown>) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const page = Math.max(0, Number(body.page) || 0)
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size) || 25))
  const search = String(body.search || '').trim().replace(/[%(),]/g, '')
  const field = String(body.field || '').trim()
  const role = String(body.role || '').trim()
  const eligibility = String(body.eligibility || '')
  let query = admin.from('ps_marketing_contacts').select('*', { count: 'exact' })
    .eq('org_id', orgId).neq('status', 'archived')
  if (search) query = query.or(`name.ilike.%${search}%,organisation_name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%,field.ilike.%${search}%,role.ilike.%${search}%`)
  if (field) query = query.eq('field', field)
  if (role) query = query.eq('role', role)
  if (eligibility === 'sms') query = query.eq('sms_eligible', true).eq('status', 'active')
  if (eligibility === 'email') query = query.eq('email_eligible', true).eq('status', 'active')
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw new Error(error.message)
  return { contacts: data || [], total: count || 0, page, page_size: pageSize }
}

/**
 * Contact filters do not depend on the current search/page. Keeping this
 * separate prevents two full facet scans every time someone types a letter.
 */
async function listContactFacets(body: Record<string, unknown>) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const { data, error } = await admin.from('ps_marketing_contacts')
    .select('field, role').eq('org_id', orgId).neq('status', 'archived').limit(1000)
  if (error) throw new Error(error.message)
  return {
    facets: {
      fields: [...new Set((data || []).map((row) => row.field).filter(Boolean))].sort(),
      roles: [...new Set((data || []).map((row) => row.role).filter(Boolean))].sort(),
    },
  }
}

async function saveContact(body: Record<string, unknown>, userId: string) {
  const admin = adminClient(); const orgId = String(body.org_id); const id = body.contact_id ? String(body.contact_id) : null
  const name = String(body.name || '').trim(); const phone = String(body.phone_number || '').trim(); const email = String(body.email || '').trim()
  if (!name) throw new Error('Contact name is required')
  if (!phone && !email) throw new Error('Add a phone number or email address')
  const normalizedPhone = phone ? (() => { try { return normalisePhone(phone) } catch { return phone.replace(/\D/g, '') || null } })() : null
  const normalizedEmail = email ? normaliseEmail(email) : null
  if (email && !normalizedEmail) throw new Error('Enter a valid email address')
  const row = { org_id: orgId, name, organisation_name: String(body.organisation_name || '').trim() || null,
    field: String(body.field || '').trim() || null, role: String(body.role || '').trim() || null,
    phone_number: phone || null, phone_normalized: normalizedPhone, email: email || null, email_normalized: normalizedEmail,
    notes: String(body.notes || '').trim(), tags: Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean) : [],
    status: String(body.status || 'active'), source_type: String(body.source_type || 'manual'), created_by: userId }
  const result = id
    ? await admin.from('ps_marketing_contacts').update(row).eq('id', id).eq('org_id', orgId).select('*').single()
    : await admin.from('ps_marketing_contacts').insert(row).select('*').single()
  if (result.error) throw new Error(result.error.message)
  return { contact: result.data }
}

async function deleteContact(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id); const id = String(body.contact_id || '')
  const { error } = await admin.from('ps_marketing_contacts').delete().eq('id', id).eq('org_id', orgId)
  if (error) throw new Error(error.message)
  return { deleted: true }
}

async function listCampaigns(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id); const channel = String(body.channel || '')
  let query = admin.from('ps_marketing_campaigns').select('*').eq('org_id', orgId)
  if (channel) query = query.eq('channel', channel)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return { campaigns: data || [] }
}

async function getCampaign(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id); const id = String(body.campaign_id || '')
  const [{ data: campaign, error }, { data: attempts }] = await Promise.all([
    admin.from('ps_marketing_campaigns').select('*').eq('org_id', orgId).eq('id', id).single(),
    admin.from('ps_marketing_attempts').select('*').eq('org_id', orgId).eq('campaign_id', id).order('created_at'),
  ])
  if (error) throw new Error(error.message)
  return { campaign, attempts: attempts || [] }
}

async function reloadCampaign(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id); const id = String(body.campaign_id || '')
  const [{ data: campaign, error }, { data: attempts }] = await Promise.all([
    admin.from('ps_marketing_campaigns').select('*').eq('org_id', orgId).eq('id', id).single(),
    admin.from('ps_marketing_attempts').select('contact_id').eq('org_id', orgId).eq('campaign_id', id).not('contact_id', 'is', null),
  ])
  if (error || !campaign) throw new Error(error?.message || 'Campaign not found')
  const contactIds = [...new Set((attempts || []).map((attempt) => attempt.contact_id).filter(Boolean))]
  if (!contactIds.length) return { campaign, contacts: [], excluded: 0 }
  let contactQuery = admin.from('ps_marketing_contacts').select('*').eq('org_id', orgId).in('id', contactIds).eq('status', 'active')
  contactQuery = campaign.channel === 'sms' ? contactQuery.eq('sms_eligible', true) : contactQuery.eq('email_eligible', true)
  const { data: contacts, error: contactsError } = await contactQuery
  if (contactsError) throw new Error(contactsError.message)
  const destinationField = campaign.channel === 'sms' ? 'phone_normalized' : 'email_normalized'
  const destinations = (contacts || []).map((contact) => contact[destinationField]).filter(Boolean)
  const { data: suppressed } = destinations.length
    ? await admin.from('ps_marketing_suppressions').select('destination_normalized').eq('org_id', orgId).eq('channel', campaign.channel).in('destination_normalized', destinations)
    : { data: [] }
  const blocked = new Set((suppressed || []).map((row) => row.destination_normalized))
  const eligible = (contacts || []).filter((contact) => !blocked.has(contact[destinationField]))
  return { campaign, contacts: eligible, excluded: contactIds.length - eligible.length }
}

async function listMarketingChats(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id)
  const { data: contacts, error } = await admin.from('ps_marketing_contacts').select('*').eq('org_id', orgId).not('phone_normalized', 'is', null).neq('status', 'archived').order('last_contacted_at', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  const phones = (contacts || []).map((row) => row.phone_normalized).filter(Boolean)
  if (!phones.length) return { conversations: [] }
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    admin.from('ps_sms_inbound').select('id,normalized_from_number,content,received_at,is_read,marketing_contact_id').eq('org_id', orgId).eq('feature', 'marketing').in('normalized_from_number', phones).order('received_at', { ascending: false }),
    admin.from('ps_messages').select('id,recipient_phone_normalized,body,status,created_at,sent_at,feature').eq('org_id', orgId).eq('channel', 'sms').eq('feature', 'marketing').in('recipient_phone_normalized', phones).order('created_at', { ascending: false }),
  ])
  return { conversations: (contacts || []).map((contact) => {
    const incoming = (inbound || []).filter((row) => row.normalized_from_number === contact.phone_normalized)
    const outgoing = (outbound || []).filter((row) => row.recipient_phone_normalized === contact.phone_normalized)
    const latestIn = incoming[0]; const latestOut = outgoing[0]
    const latest = !latestOut || (latestIn && new Date(latestIn.received_at) > new Date(latestOut.sent_at || latestOut.created_at))
      ? latestIn && { body: latestIn.content, at: latestIn.received_at, direction: 'inbound' }
      : latestOut && { body: latestOut.body, at: latestOut.sent_at || latestOut.created_at, direction: 'outbound' }
    return { contact, latest, unread: incoming.filter((row) => !row.is_read).length }
  }).filter((row) => row.latest).sort((a, b) => new Date(b.latest.at).getTime() - new Date(a.latest.at).getTime()) }
}

async function getMarketingThread(body: Record<string, unknown>) {
  const admin = adminClient(); const orgId = String(body.org_id); const contactId = String(body.contact_id || '')
  const { data: contact } = await admin.from('ps_marketing_contacts').select('*').eq('org_id', orgId).eq('id', contactId).single()
  if (!contact?.phone_normalized) throw new Error('Contact has no phone number')
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    admin.from('ps_sms_inbound').select('*').eq('org_id', orgId).eq('feature', 'marketing').eq('normalized_from_number', contact.phone_normalized).order('received_at'),
    admin.from('ps_messages').select('*').eq('org_id', orgId).eq('channel', 'sms').eq('feature', 'marketing').eq('recipient_phone_normalized', contact.phone_normalized).order('created_at'),
  ])
  await admin.from('ps_sms_inbound').update({ is_read: true }).eq('org_id', orgId).eq('feature', 'marketing').eq('normalized_from_number', contact.phone_normalized)
  const messages = [...(inbound || []).map((row) => ({ id: row.id, direction: 'inbound', body: row.content, at: row.received_at, status: 'received' })),
    ...(outbound || []).map((row) => ({ id: row.id, direction: 'outbound', body: row.body, at: row.sent_at || row.created_at, status: row.status }))]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return { contact, messages }
}

async function sendMarketingReply(body: Record<string, unknown>, userId: string, authHeader: string) {
  const admin = adminClient(); const orgId = String(body.org_id); const contactId = String(body.contact_id || ''); const content = String(body.body || '').trim()
  if (!content) throw new Error('Reply cannot be empty')
  const { data: contact } = await admin.from('ps_marketing_contacts').select('*').eq('org_id', orgId).eq('id', contactId).single()
  if (!contact?.sms_eligible) throw new Error('This contact does not have an eligible UK mobile number')
  if (contact.status !== 'active') throw new Error('This contact cannot receive SMS')
  const { data: suppression } = await admin.from('ps_marketing_suppressions').select('id').eq('org_id', orgId).eq('channel', 'sms').eq('destination_normalized', contact.phone_normalized).maybeSingle()
  if (suppression) throw new Error('This contact has opted out of SMS')
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-works`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader }, body: JSON.stringify({ action: 'send_sms', org_id: orgId, phone_number: contact.phone_normalized, body: content, feature: 'marketing', reference: `marketing_chat:${contact.id}`, use_reply_number: true }) })
  const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || 'Reply failed')
  await admin.from('ps_marketing_contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', contactId)
  return { message: result }
}

function campaignReference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(6, '0').slice(-6)
  return `PS-MKT-${date}-${random}`
}

async function prepareEmailCampaign(body: Record<string, unknown>, userId: string) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const name = String(body.name || '').trim()
  const subject = String(body.subject || '').trim()
  const bodyTemplate = String(body.body || '').trim()
  const recipientIds = Array.isArray(body.contact_ids) ? body.contact_ids.map(String) : []
  const directoryRows = Array.isArray(body.directory_recipients) ? body.directory_recipients : []
  if (!name || !subject || !bodyTemplate || recipientIds.length + directoryRows.length === 0) throw new Error('Campaign name, subject, copy and recipients are required')
  if (recipientIds.length + directoryRows.length > 500) throw new Error('A prepared email campaign is limited to 500 recipients')

  const directoryRecipients = directoryRows.flatMap((recipient) => {
    const row = recipient as Record<string, unknown>
    const email = normaliseEmail(String(row.email || ''))
    const recipientName = String(row.organisation_name || '').trim()
    return email && recipientName ? [{
      contact_id: null,
      recipient_name: recipientName,
      email,
      ods_code: String(row.ods_code || ''),
      city: String(row.city || ''),
      postcode: String(row.postcode || ''),
    }] : []
  })

  const { data: contacts, error: contactError } = await admin.from('ps_marketing_contacts')
    .select('id, name, organisation_name, email_normalized, email_eligible, status').eq('org_id', orgId).in('id', recipientIds)
  if (contactError) throw new Error(contactError.message)
  const crmRecipients = (contacts || []).filter((contact) => contact.status === 'active' && contact.email_eligible && contact.email_normalized)
    .map((contact) => ({ contact_id: contact.id, recipient_name: contact.name || contact.organisation_name, email: contact.email_normalized, ods_code: '', city: '', postcode: '' }))
  // Directory recipients remain immutable snapshots. They do not become CRM
  // contacts unless a user deliberately creates one in the Contacts module.
  const recipients = [...new Map([...crmRecipients, ...directoryRecipients].map((recipient) => [recipient.email, recipient])).values()]
  if (!recipients.length) throw new Error('No selected pharmacies have an email address')

  const { data: suppressed } = await admin.from('ps_marketing_suppressions').select('destination_normalized')
    .eq('org_id', orgId).eq('channel', 'email').in('destination_normalized', recipients.map((row) => row.email))
  const blocked = new Set((suppressed || []).map((row) => row.destination_normalized))
  const eligible = recipients.filter((row) => !blocked.has(row.email))
  if (!eligible.length) throw new Error('Every selected email address is suppressed')

  const reference = campaignReference()
  const { data: campaign, error: campaignError } = await admin.from('ps_marketing_campaigns').insert({
    org_id: orgId, channel: 'email', name, subject, body: bodyTemplate,
    status: 'prepared', recipient_count: eligible.length, campaign_reference: reference,
    created_by: userId, metadata: { method: 'native_mail_app' },
  }).select('id, campaign_reference').single()
  if (campaignError) throw new Error(campaignError.message)
  const { error: attemptsError } = await admin.from('ps_marketing_attempts').insert(eligible.map((recipient) => ({
    campaign_id: campaign.id, org_id: orgId, contact_id: recipient.contact_id,
    recipient_name: recipient.recipient_name, channel: 'email', destination_normalized: recipient.email,
    provider: 'native_mail_app', status: 'prepared', outcome: 'prepared',
  })))
  if (attemptsError) { await admin.from('ps_marketing_campaigns').delete().eq('id', campaign.id); throw new Error(attemptsError.message) }
  return { campaign_id: campaign.id, campaign_reference: reference, recipients: eligible, suppressed: recipients.length - eligible.length }
}

async function markEmailCampaign(body: Record<string, unknown>) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const campaignId = String(body.campaign_id || '')
  const event = String(body.event || '')
  const now = new Date().toISOString()
  const { data: campaign } = await admin.from('ps_marketing_campaigns').select('id, recipient_count')
    .eq('id', campaignId).eq('org_id', orgId).eq('channel', 'email').maybeSingle()
  if (!campaign) throw new Error('Email campaign not found')
  if (event === 'opened') {
    await Promise.all([
      admin.from('ps_marketing_campaigns').update({ status: 'opened', opened_in_mail_app_at: now, updated_at: now }).eq('id', campaignId),
      admin.from('ps_marketing_attempts').update({ outcome: 'opened', status: 'opened', outcome_at: now, updated_at: now }).eq('campaign_id', campaignId).eq('outcome', 'prepared'),
    ])
    return { status: 'opened' }
  }
  if (event === 'confirmed_sent') {
    await Promise.all([
      admin.from('ps_marketing_campaigns').update({ status: 'manually_confirmed', sent_count: campaign.recipient_count, sent_at: now, manually_confirmed_at: now, updated_at: now }).eq('id', campaignId),
      admin.from('ps_marketing_attempts').update({ outcome: 'sent', status: 'sent', outcome_at: now, updated_at: now }).eq('campaign_id', campaignId).in('outcome', ['prepared', 'opened']),
    ])
    return { status: 'manually_confirmed' }
  }
  if (event === 'cancelled') {
    await admin.from('ps_marketing_campaigns').update({ status: 'cancelled', updated_at: now }).eq('id', campaignId)
    return { status: 'cancelled' }
  }
  throw new Error('Unknown email campaign event')
}

async function sendSmsCampaign(body: Record<string, unknown>, userId: string, authHeader: string) {
  const admin = adminClient()
  const orgId = String(body.org_id)
  const name = String(body.name || '').trim()
  const rawBody = String(body.body || '').trim()
  const contactIds = Array.isArray(body.contact_ids) ? body.contact_ids.map(String) : []
  if (!name || !rawBody || contactIds.length === 0) throw new Error('Campaign name, message and recipients are required')
  if (contactIds.length > 50) throw new Error('A campaign is limited to 50 recipients per send')

  const { data: settings } = await admin.from('ps_sms_settings').select('is_active, reply_enabled, reply_number').eq('org_id', orgId).maybeSingle()
  if (!settings?.is_active) throw new Error('SMS Works is not enabled for this organisation')
  if (!settings.reply_enabled || !settings.reply_number) throw new Error('A reply number must be assigned before marketing SMS can be sent')

  const content = /reply\s+stop/i.test(rawBody) ? rawBody : `${rawBody}\nReply STOP to opt out.`
  const { data: contacts, error: contactsError } = await admin.from('ps_marketing_contacts').select('*').eq('org_id', orgId).in('id', contactIds).eq('status', 'active')
  if (contactsError) throw new Error(contactsError.message)
  if (!contacts?.length) throw new Error('No active contacts were selected')

  const destinations = contacts.map((contact) => normalisePhone(contact.phone_normalized || contact.phone_number))
  const { data: suppressed } = await admin.from('ps_marketing_suppressions').select('destination_normalized').eq('org_id', orgId).eq('channel', 'sms').in('destination_normalized', destinations)
  const blocked = new Set((suppressed || []).map((row) => row.destination_normalized))
  const eligible = contacts.filter((contact) => !blocked.has(normalisePhone(contact.phone_normalized || contact.phone_number)))
  if (!eligible.length) throw new Error('Every selected contact is suppressed')

  const { data: campaign, error: campaignError } = await admin.from('ps_marketing_campaigns').insert({
    org_id: orgId, channel: 'sms', name, body: content, status: 'sending', recipient_count: eligible.length, created_by: userId,
  }).select('*').single()
  if (campaignError) throw new Error(campaignError.message)

  let sent = 0
  let failed = 0
  for (const contact of eligible) {
    const destination = normalisePhone(contact.phone_normalized || contact.phone_number)
    try {
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-works`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ action: 'send_sms', org_id: orgId, phone_number: destination, body: content, feature: 'marketing', reference: `marketing:${campaign.id}:${contact.id}`, use_reply_number: true }),
      })
      const result = await response.json()
      if (!response.ok || result.error) throw new Error(result.error || `SMS Works returned ${response.status}`)
      await admin.from('ps_marketing_attempts').insert({ campaign_id: campaign.id, org_id: orgId, contact_id: contact.id, channel: 'sms', destination_normalized: destination, provider: 'smsworks', provider_message_id: result.notify_message_id || null, message_id: result.id || null, status: result.status || 'sent' })
      await admin.from('ps_marketing_contacts').update({ last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', contact.id)
      sent++
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Send failed'
      await admin.from('ps_marketing_attempts').insert({ campaign_id: campaign.id, org_id: orgId, contact_id: contact.id, channel: 'sms', destination_normalized: destination, provider: 'smsworks', status: 'failed', failure_reason: reason })
      failed++
    }
  }

  const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial'
  await admin.from('ps_marketing_campaigns').update({ status, sent_count: sent, failed_count: failed, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', campaign.id)
  return { campaign_id: campaign.id, status, sent, failed, suppressed: contacts.length - eligible.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('Unauthorized')
    const body = await req.json() as Record<string, unknown>
    const orgId = String(body.org_id || '')
    if (!orgId) throw new Error('Missing org_id')
    const { data: membership } = await adminClient().from('ps_organisation_members').select('user_id').eq('organisation_id', orgId).eq('user_id', user.id).eq('status', 'active').maybeSingle()
    if (!membership) throw new Error('You do not have access to this organisation')

    if (body.action === 'list_email_recipients') return json(await listEmailRecipients(body))
    if (body.action === 'import_directory_email_contacts') return json(await importDirectoryEmailContacts(body, user.id))
    if (body.action === 'list_contacts') return json(await listContacts(body))
    if (body.action === 'list_contact_facets') return json(await listContactFacets(body))
    if (body.action === 'save_contact') return json(await saveContact(body, user.id))
    if (body.action === 'delete_contact') return json(await deleteContact(body))
    if (body.action === 'list_campaigns') return json(await listCampaigns(body))
    if (body.action === 'get_campaign') return json(await getCampaign(body))
    if (body.action === 'reload_campaign') return json(await reloadCampaign(body))
    if (body.action === 'list_marketing_chats') return json(await listMarketingChats(body))
    if (body.action === 'get_marketing_thread') return json(await getMarketingThread(body))
    if (body.action === 'send_marketing_reply') return json(await sendMarketingReply(body, user.id, authHeader))
    if (body.action === 'prepare_email_campaign') return json(await prepareEmailCampaign(body, user.id))
    if (body.action === 'mark_email_campaign') return json(await markEmailCampaign(body))
    if (body.action === 'send_sms_campaign') return json(await sendSmsCampaign(body, user.id, authHeader))
    throw new Error('Unknown action')
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
