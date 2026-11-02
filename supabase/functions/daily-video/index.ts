import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DAILY_API_BASE = 'https://api.daily.co/v1'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// --- Daily API helper ---
async function dailyFetch(path: string, options: RequestInit = {}) {
  const apiKey = Deno.env.get('DAILY_API_KEY')
  if (!apiKey) throw new Error('DAILY_API_KEY not configured')
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Daily API ${res.status}: ${err.error || 'unknown'}`)
  }
  return res.json()
}

function generateAccessCode(): string {
  // crypto RNG: the patient access code is a credential.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000
  return String(100000 + n)
}

// --- Supabase admin client ---
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// The admin client bypasses RLS, so this is the tenant check: the caller
// must be the org's own auth user or an active member of the org.
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const admin = getAdminClient()
  const { data: org } = await admin
    .from('ps_organisations').select('auth_user_id').eq('id', orgId).maybeSingle()
  if (!org) return false
  if (org.auth_user_id === userId) return true
  const { data: member } = await admin
    .from('ps_organisation_members').select('user_id')
    .eq('organisation_id', orgId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle()
  return !!member
}

async function assertConsultationAccess(consultationId: string, userId: string) {
  const { data } = await getAdminClient()
    .from('ps_video_consultations').select('org_id').eq('id', consultationId).maybeSingle()
  if (!data || !(await isOrgMember(userId, data.org_id))) throw new Error('Consultation not found')
}

// --- Action: create_room ---
async function handleCreateRoom(body: any, userId: string) {
  const { org_id, patient_name, patient_phone, patient_id, appointment_id, scheduled_for } = body
  if (!org_id || !patient_name || !scheduled_for) {
    throw new Error('Missing required fields: org_id, patient_name, scheduled_for')
  }
  if (typeof org_id !== 'string' || !(await isOrgMember(userId, org_id))) throw new Error('Forbidden')

  const roomName = `ps-${org_id.slice(0, 8)}-${Date.now()}`
  const scheduledDate = new Date(scheduled_for)
  const expirySeconds = Math.floor(scheduledDate.getTime() / 1000) + 7200 // +2 hours

  // 1. Create Daily room
  const room = await dailyFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: expirySeconds,
        enable_prejoin_ui: false,
        enable_chat: true,
        enable_screenshare: true,
        enable_knocking: false,
        max_participants: 4,
        start_video_off: false,
        start_audio_off: false,
        geo: 'eu-west-2',
      },
    }),
  })

  // 2. Create staff token (owner)
  const staffToken = await dailyFetch('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: true,
        exp: expirySeconds,
        user_name: 'Pharmacist',
      },
    }),
  })

  // 3. Create patient token (participant)
  const patientToken = await dailyFetch('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: false,
        exp: expirySeconds,
        user_name: patient_name,
        enable_screenshare: false,
      },
    }),
  })

  // 4. Generate access code
  const accessCode = generateAccessCode()

  // 5. Insert consultation record
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ps_video_consultations')
    .insert({
      org_id,
      patient_id: patient_id || null,
      patient_name,
      patient_phone: patient_phone || null,
      daily_room_name: room.name,
      daily_room_url: room.url,
      org_token: staffToken.token,
      patient_token: patientToken.token,
      patient_access_code: accessCode,
      status: 'scheduled',
      appointment_id: appointment_id || null,
      scheduled_for,
    })
    .select()
    .single()

  if (error) throw error

  return { consultation: data, patient_link: `/consult/${data.id}` }
}

// --- Action: end_consultation ---
async function handleEndConsultation(body: any, userId: string) {
  const { consultation_id } = body
  if (!consultation_id) throw new Error('Missing consultation_id')
  await assertConsultationAccess(consultation_id, userId)

  const admin = getAdminClient()

  // Fetch the consultation to get room name
  const { data: consult, error: fetchErr } = await admin
    .from('ps_video_consultations')
    .select('daily_room_name, status')
    .eq('id', consultation_id)
    .single()

  if (fetchErr || !consult) throw new Error('Consultation not found')

  // Update status
  const { data, error } = await admin
    .from('ps_video_consultations')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', consultation_id)
    .select()
    .single()

  if (error) throw error

  // Delete Daily room (best-effort)
  try {
    await dailyFetch(`/rooms/${consult.daily_room_name}`, { method: 'DELETE' })
  } catch (_) {
    // Room may already be expired/deleted
  }

  return { consultation: data }
}

// --- Action: get_staff_token ---
async function handleGetStaffToken(body: any, userId: string) {
  const { consultation_id } = body
  if (!consultation_id) throw new Error('Missing consultation_id')
  await assertConsultationAccess(consultation_id, userId)

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ps_video_consultations')
    .select('org_token, org_id, status')
    .eq('id', consultation_id)
    .single()

  if (error || !data) throw new Error('Consultation not found')
  if (data.status === 'completed' || data.status === 'cancelled') {
    throw new Error('Consultation is no longer active')
  }

  return { org_token: data.org_token }
}

// --- Action: verify_access_code (convenience wrapper) ---
async function handleVerifyAccessCode(body: any) {
  const { consultation_id, access_code } = body
  if (!consultation_id || !access_code) throw new Error('Missing consultation_id or access_code')

  const admin = getAdminClient()
  const { data, error } = await admin.rpc('ps_verify_video_access_code', {
    p_consultation_id: consultation_id,
    p_access_code: access_code,
  })

  if (error) throw error
  return data
}

// --- Main handler ---
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    // verify_access_code is public — no auth needed
    if (action === 'verify_access_code') {
      const result = await handleVerifyAccessCode(body)
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // All other actions require auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    let result: any
    switch (action) {
      case 'create_room':
        result = await handleCreateRoom(body, user.id)
        break
      case 'end_consultation':
        result = await handleEndConsultation(body, user.id)
        break
      case 'get_staff_token':
        result = await handleGetStaffToken(body, user.id)
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
