// ============================================================
// Create the Daily video room for a booked video appointment.
// Same room/token settings as daily-video's create_room (staff path), but
// called by the platform when a video service booking is due, so there is
// no staff session. Returns the existing consultation if there is one.
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const DAILY_API_BASE = 'https://api.daily.co/v1'

async function dailyFetch(path: string, body: unknown) {
  const apiKey = Deno.env.get('DAILY_API_KEY')
  if (!apiKey) throw new Error("Video calls aren't set up yet. Please contact PharmStation support.")
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('Daily API error', res.status, (err as { error?: string }).error)
    if (res.status === 401 || res.status === 403) {
      throw new Error("Video calls aren't set up correctly. Please contact PharmStation support.")
    }
    throw new Error('The video service could not set up the call. Please try again in a minute.')
  }
  return res.json()
}

function accessCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000
  return String(100000 + n)
}

export type VideoConsult = { id: string; patient_access_code: string }

export async function ensureVideoConsult(
  db: SupabaseClient,
  b: {
    id: string; org_id: string; patient_id: string | null
    patient_name: string; patient_phone: string | null; start_time: string
  },
): Promise<VideoConsult> {
  const { data: existing } = await db.from('ps_video_consultations')
    .select('id, patient_access_code')
    .eq('appointment_id', b.id).not('status', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing) return existing as VideoConsult

  const exp = Math.floor(new Date(b.start_time).getTime() / 1000) + 7200
  const roomName = `ps-${b.org_id.slice(0, 8)}-${Date.now()}`
  const room = await dailyFetch('/rooms', {
    name: roomName,
    privacy: 'private',
    properties: {
      exp,
      enable_prejoin_ui: false,
      enable_chat: true,
      enable_screenshare: true,
      enable_knocking: false,
      max_participants: 4,
      start_video_off: false,
      start_audio_off: false,
      geo: 'eu-west-2',
    },
  })
  const staff = await dailyFetch('/meeting-tokens', {
    properties: { room_name: roomName, is_owner: true, exp, user_name: 'Pharmacist' },
  })
  const patient = await dailyFetch('/meeting-tokens', {
    properties: { room_name: roomName, is_owner: false, exp, user_name: b.patient_name, enable_screenshare: false },
  })

  const { data, error } = await db.from('ps_video_consultations').insert({
    org_id: b.org_id,
    patient_id: b.patient_id,
    patient_name: b.patient_name,
    patient_phone: b.patient_phone,
    daily_room_name: room.name,
    daily_room_url: room.url,
    org_token: staff.token,
    patient_token: patient.token,
    patient_access_code: accessCode(),
    status: 'scheduled',
    appointment_id: b.id,
    scheduled_for: b.start_time,
  }).select('id, patient_access_code').single()
  if (error) throw new Error(`video consult insert failed: ${error.message}`)
  return data as VideoConsult
}
