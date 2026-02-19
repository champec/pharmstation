# Agent 4 — Video Consultations (Daily Prebuilt)

> **Wave:** 2 (runs in PARALLEL with Agents 1, 2, 3, 5 — after Agent 0 completes)
> **Prerequisite:** Agent 0 (Foundation) must be complete
> **Base plan:** `documentation/expansion/expansion-plan.md` — Phase 4
> **Assumes:** All types already exist in `@pharmstation/types`, all routes already wired in `App.tsx`, all nav items already in `SideNav.tsx`, all placeholder pages already created by Agent 0.

This agent builds the **Video Consultations** feature using **Daily Prebuilt** — Daily's drop-in embedded video UI. The pharmacy creates a video consultation, gets a 6-digit access code to share with the patient, and the patient joins a fully functional video call (camera, mic, screen share, chat) in their browser with zero account creation or app installation.

---

## Scope Summary

1. Create the video consultations database migration (1 table + RPC)
2. Install `@daily-co/daily-js`
3. Create the `daily-video` edge function (room lifecycle + access code verification)
4. Implement `VideoConsultsPage` — staff consultation list
5. Implement `VideoRoomPage` — staff-side Daily Prebuilt iframe
6. Implement `PatientVideoPage` — public access-code → video call

---

## Architecture: Daily Prebuilt

We use [Daily Prebuilt](https://docs.daily.co/reference/daily-js/daily-iframe-class) — not custom video components. This gives us camera, mic, screen share, chat, and recording out of the box.

**What PharmStation controls:**
- **Access gating:** patient enters a 6-digit numeric access code on our page before the Daily Prebuilt iframe loads. The code is verified against `ps_video_consultations.patient_access_code` via a public Supabase RPC (no auth required).
- **Auto-join for patients:** patient iframe is configured with `enable_prejoin_ui: false` at room creation time, so patients land directly in the call. `userName` is pre-filled from the consultation record — patient never types anything.
- **Staff controls:** staff see the standard Daily Prebuilt UI plus PharmStation controls around it: end consultation button (updates DB status), patient details sidebar, appointment context.
- **Room lifecycle:** rooms are created/destroyed via our edge function — never by users directly.

**Only `@daily-co/daily-js` is needed** — no `@daily-co/daily-react`. The Prebuilt handles all UI. We use `daily-js` only to create the iframe and listen to lifecycle events (`joined-meeting`, `left-meeting`).

---

## 1. Database Migration

Create: `supabase/migrations/20260219_video.sql`

```sql
-- ===========================================
-- PharmStation: Video Consultations
-- ===========================================

CREATE TABLE ps_video_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  patient_name text NOT NULL,
  patient_phone text,
  daily_room_name text NOT NULL UNIQUE,
  daily_room_url text NOT NULL,
  org_token text NOT NULL,
  patient_token text NOT NULL,
  patient_access_code text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  appointment_id uuid REFERENCES ps_appointments(id) ON DELETE SET NULL,
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  access_code_attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_consults_org ON ps_video_consultations(org_id);
CREATE INDEX idx_video_consults_status ON ps_video_consultations(org_id, status);
CREATE INDEX idx_video_consults_scheduled ON ps_video_consultations(scheduled_for);
CREATE INDEX idx_video_consults_access_code ON ps_video_consultations(id, patient_access_code);

ALTER TABLE ps_video_consultations ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD on their org's consultations
CREATE POLICY "org_members_crud_video"
  ON ps_video_consultations FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Public RPC: verify access code (no direct table access for anon)
-- The verify function is defined below as a SECURITY DEFINER function.


-- ===========================================
-- RPC: verify_video_access_code (public, no auth required)
-- ===========================================
-- Returns the room URL, patient token, and patient name if the code matches
-- and the consultation is still live. Rate-limited to 5 attempts per consultation.

CREATE OR REPLACE FUNCTION ps_verify_video_access_code(
  p_consultation_id uuid,
  p_access_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row ps_video_consultations%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Fetch the consultation
  SELECT * INTO v_row
  FROM ps_video_consultations
  WHERE id = p_consultation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  -- Check rate limit
  IF v_row.access_code_attempts >= 5 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'too_many_attempts');
  END IF;

  -- Increment attempts
  UPDATE ps_video_consultations
  SET access_code_attempts = access_code_attempts + 1
  WHERE id = p_consultation_id;

  -- Check status
  IF v_row.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'consultation_ended');
  END IF;

  -- Verify code
  IF v_row.patient_access_code != p_access_code THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_code');
  END IF;

  -- Success — return room details
  -- Also mark as active if it was scheduled
  IF v_row.status = 'scheduled' THEN
    UPDATE ps_video_consultations
    SET status = 'active', started_at = now()
    WHERE id = p_consultation_id;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'room_url', v_row.daily_room_url,
    'patient_token', v_row.patient_token,
    'patient_name', v_row.patient_name
  );
END;
$$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION ps_verify_video_access_code(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION ps_verify_video_access_code(uuid, text) TO authenticated;
```

---

## 2. Install Daily

Add to `apps/web/package.json` dependencies:

```bash
cd apps/web && pnpm add @daily-co/daily-js
```

**No `@daily-co/daily-react` needed** — Prebuilt handles all UI. We only use `daily-js` to create/destroy the iframe and listen to lifecycle events.

---

## 3. Edge Function: `daily-video`

Create: `supabase/functions/daily-video/index.ts`

This edge function handles all Daily REST API interactions. The Daily API key is stored as a Supabase secret (`DAILY_API_KEY`) and is **never** exposed to the client.

### Request format

All requests are POST with JSON body: `{ action: string, ...params }`. Auth is required for all actions except where noted.

### Helper: Daily API wrapper

```typescript
const DAILY_API_BASE = 'https://api.daily.co/v1'

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
    throw new Error(`Daily API error ${res.status}: ${err.error || 'unknown'}`)
  }

  return res.json()
}
```

### Helper: Generate 6-digit access code

```typescript
function generateAccessCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}
```

### Action: `create_room`

**Auth:** Required (staff).

**Input:**
```typescript
{
  action: 'create_room',
  org_id: string,
  patient_name: string,
  patient_phone?: string,       // for optional SMS notification
  patient_id?: string,          // FK to ps_patients
  appointment_id?: string,      // FK to ps_appointments (optional link)
  scheduled_for: string,        // ISO 8601 timestamp
}
```

**Steps:**

1. Generate a unique room name: `ps-${org_id.slice(0,8)}-${Date.now()}`.

2. Calculate room expiry: `scheduled_for + 2 hours` (as unix seconds).

3. **Create Daily room:**
   ```
   POST https://api.daily.co/v1/rooms
   {
     "name": "<room_name>",
     "privacy": "private",
     "properties": {
       "exp": <expiry_unix_seconds>,
       "enable_prejoin_ui": false,
       "enable_chat": true,
       "enable_screenshare": true,
       "enable_knocking": false,
       "max_participants": 4,
       "start_video_off": false,
       "start_audio_off": false,
       "geo": "eu-west-2"
     }
   }
   ```
   Response includes `url` (e.g. `https://your-domain.daily.co/ps-abc12345-1708300000`) and `name`.

4. **Create staff meeting token:**
   ```
   POST https://api.daily.co/v1/meeting-tokens
   {
     "properties": {
       "room_name": "<room_name>",
       "is_owner": true,
       "exp": <expiry_unix_seconds>,
       "user_name": "Pharmacist"
     }
   }
   ```
   Response includes `token`.

5. **Create patient meeting token:**
   ```
   POST https://api.daily.co/v1/meeting-tokens
   {
     "properties": {
       "room_name": "<room_name>",
       "is_owner": false,
       "exp": <expiry_unix_seconds>,
       "user_name": "<patient_name>",
       "enable_screenshare": false
     }
   }
   ```

6. Generate 6-digit `patient_access_code`.

7. **Insert** row into `ps_video_consultations`:
   ```typescript
   {
     org_id,
     patient_id,
     patient_name,
     patient_phone,
     daily_room_name: room.name,
     daily_room_url: room.url,
     org_token: staffToken.token,
     patient_token: patientToken.token,
     patient_access_code: accessCode,
     status: 'scheduled',
     appointment_id,
     scheduled_for,
   }
   ```

8. **Return** the consultation record including `patient_access_code` and the public URL path: `/consult/${consultation.id}`.

> **Note:** If the org has NHS Notify configured (Phase 5), and `patient_phone` is provided, the edge function can optionally invoke the `nhs-notify` function to send an SMS with the access code and link. For now, this is a TODO — check if `nhs-notify` function exists before calling. If not configured, skip silently.

### Action: `verify_access_code`

**Auth:** None required (public endpoint).

This is handled by the Supabase RPC function `ps_verify_video_access_code` defined in the migration, **not** in the edge function. The client calls it directly:

```typescript
const { data } = await supabase.rpc('ps_verify_video_access_code', {
  p_consultation_id: consultationId,
  p_access_code: code,
})
```

However, the edge function also exposes this action as a convenience wrapper:

**Input:**
```typescript
{
  action: 'verify_access_code',
  consultation_id: string,
  access_code: string,
}
```

**Steps:**
1. Create a Supabase admin client (service role).
2. Call `rpc('ps_verify_video_access_code', ...)`.
3. Return the result.

This allows calling from the public patient page without any Supabase client — a simple `fetch()` to the edge function URL.

### Action: `end_consultation`

**Auth:** Required (staff).

**Input:**
```typescript
{
  action: 'end_consultation',
  consultation_id: string,
}
```

**Steps:**
1. Update status to `'completed'`, set `ended_at = now()`.
2. **Delete the Daily room** to clean up:
   ```
   DELETE https://api.daily.co/v1/rooms/<room_name>
   ```
   (Rate limit: 2 req/s — acceptable for one-off calls.)
3. Return updated consultation.

### Action: `get_staff_token`

**Auth:** Required (staff).

**Input:**
```typescript
{
  action: 'get_staff_token',
  consultation_id: string,
}
```

**Steps:**
1. Fetch consultation from DB (verify org_id matches user's org).
2. Return `{ org_token }`.

This is used when the staff navigates to the video room and needs the token to join.

---

## 4. VideoConsultsPage

Replace placeholder at: `apps/web/src/pages/video/VideoConsultsPage.tsx`

**Requirements:**

- On mount, fetch video consultations from `ps_video_consultations` where `org_id` matches and `status IN ('scheduled', 'active')`, ordered by `scheduled_for ASC`:
  ```typescript
  const { data } = await getUserClient()
    .from('ps_video_consultations')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['scheduled', 'active'])
    .order('scheduled_for', { ascending: true })
  ```

- **Header:** "Video Consultations" with "New Consultation" button.

- **Consultations table** (TanStack Table):
  | Column | Content |
  |---|---|
  | Patient | `patient_name` |
  | Phone | `patient_phone` |
  | Scheduled | formatted `scheduled_for` (date + time) |
  | Status | Badge: scheduled (blue), active (green pulse animation), completed (grey), cancelled (red) |
  | Access Code | `patient_access_code` shown in monospace, with copy button |
  | Actions | "Join" (→ `/video/:id`), "Copy Patient Link" (copies `/consult/:id`), "Cancel" |

- **"New Consultation" modal/drawer:**
  - Fields:
    - Patient search (typeahead against `ps_patients` for org) — optional, can enter name manually.
    - Patient name (text, required — pre-filled if patient selected).
    - Patient phone (text, optional).
    - Date & time picker for `scheduled_for`.
    - Appointment link (optional dropdown of upcoming appointments for the patient).
  - On submit: calls `daily-video` edge function with `action: 'create_room'`.
  - On success: shows the created consultation with access code prominently, and a "Copy Patient Link" button.

- **"Cancel" action:** sets status to `cancelled` via update, optionally calls `end_consultation` edge function if room exists.

- **Tab filter:** "Upcoming" (scheduled) | "Active" (active) | "Past" (completed + cancelled) — past shows last 30 days.

---

## 5. VideoRoomPage

Replace placeholder at: `apps/web/src/pages/video/VideoRoomPage.tsx`

**Requirements:**

- URL param: `consultationId`.
- On mount:
  1. Fetch consultation from DB.
  2. Call `get_staff_token` edge function action to get the token.
  3. Render the Daily Prebuilt iframe.

- **Daily Prebuilt iframe integration:**
  ```typescript
  import DailyIframe from '@daily-co/daily-js'

  // In useEffect or similar:
  const callFrame = DailyIframe.createFrame(containerEl, {
    iframeStyle: {
      width: '100%',
      height: '100%',
      border: '0',
      borderRadius: '12px',
    },
    showLeaveButton: true,
    showFullscreenButton: true,
  })

  await callFrame.join({
    url: consultation.daily_room_url,
    token: orgToken,
  })
  ```

- **Layout:** full-width/height iframe taking up the main content area. Staff sees the standard Daily Prebuilt UI inside (camera controls, mic, screen share, chat, participant list).

- **Sidebar/overlay** around the iframe (e.g. right sidebar or top bar):
  - Patient name, phone, scheduled time.
  - If linked to appointment: appointment details, service name.
  - **"End Consultation" button** (red, prominent). On click:
    - Calls `end_consultation` edge function action.
    - Destroys the iframe: `callFrame.destroy()`.
    - Navigates back to `/video`.

- **Event listeners:**
  - `callFrame.on('left-meeting', () => { ... })` — if staff clicks Daily's own leave button, prompt: "End consultation for all?" or just "You left, the patient may still be in the room."
  - On component unmount: `callFrame.destroy()` to clean up.

- **Error handling:** if consultation is `completed` or `cancelled`, show "This consultation has ended" and link back to `/video`.

---

## 6. PatientVideoPage

Replace placeholder at: `apps/web/src/pages/video/PatientVideoPage.tsx`

**This is a PUBLIC page — no auth required.** Route: `/consult/:consultationId`.

**Requirements:**

### Step 1: Access Code Entry

- Clean, minimal page. Shows org branding if available (fetch org details from consultation → org → `public_logo_url`).
- Heading: "Join Your Video Consultation".
- Subheading: "Enter the 6-digit code you received from your pharmacy."
- **6-digit code input:** 6 individual digit input boxes, auto-advance to next on input, auto-submit when all 6 filled. Each box is a single numeric character. Think OTP-style input.
  ```
  [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ] [ 6 ]
  ```
- Paste support: paste a 6-digit number and it fills all boxes.
- "Join Call" button (disabled until 6 digits entered).
- On submit: call `ps_verify_video_access_code` RPC (or `daily-video` edge function `verify_access_code` action via fetch).
- If invalid: show error "Invalid code. Please try again." with attempts remaining.
- If too many attempts: show "Too many attempts. Please contact your pharmacy."
- If consultation ended: show "This consultation has ended."

### Step 2: Video Call

On successful verification, the response includes `room_url`, `patient_token`, and `patient_name`.

- Transition from code entry to full-screen video:
  ```typescript
  import DailyIframe from '@daily-co/daily-js'

  const callFrame = DailyIframe.createFrame(containerEl, {
    iframeStyle: {
      width: '100%',
      height: '100%',
      border: '0',
    },
    showLeaveButton: true,
    showFullscreenButton: true,
  })

  await callFrame.join({
    url: roomUrl,
    token: patientToken,
    userName: patientName,  // auto-filled — patient doesn't type anything
  })
  ```

- **Key UX:** patient goes straight into the call. No lobby, no pre-join UI (disabled at room creation via `enable_prejoin_ui: false`). Their name is already set. They just see the video call.

- **Mobile-friendly:** works on mobile browsers (Safari, Chrome). No app install needed. Use responsive layout — iframe fills viewport.

### Step 3: Call Ended

- Listen for `callFrame.on('left-meeting', ...)` event.
- On call end: destroy iframe, show "Call Ended" screen:
  - "Your video consultation has ended."
  - "If you need to speak with the pharmacy again, please call [phone number]." (pharmacy phone from org record if available).
  - Clean, friendly exit page.

### Design notes:
- Use the pharmacy's branding colour if available (`ps_organisations.brand_colour` or similar). Fallback to PharmStation's default.
- Keep the page extremely simple — many patients will be elderly or non-technical.
- Large, clear text. Accessible colour contrast.
- No navigation chrome. No header/footer. A standalone, self-contained page.

---

## Edge Function File Structure

```
supabase/functions/daily-video/
  index.ts       — main handler, routes by action
```

### `index.ts` — Full structure

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DAILY_API_BASE = 'https://api.daily.co/v1'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  return String(Math.floor(100000 + Math.random() * 900000))
}

// --- Create Supabase admin client ---
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// --- Action handlers ---

async function handleCreateRoom(body: any, userId: string) {
  const { org_id, patient_name, patient_phone, patient_id, appointment_id, scheduled_for } = body
  if (!org_id || !patient_name || !scheduled_for) {
    throw new Error('Missing required fields: org_id, patient_name, scheduled_for')
  }

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
        geo: 'eu-west-2', // London — closest to UK users
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

async function handleEndConsultation(body: any, userId: string) {
  const { consultation_id } = body
  if (!consultation_id) throw new Error('Missing consultation_id')

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

  // Delete Daily room (best-effort, don't fail if this errors)
  try {
    await dailyFetch(`/rooms/${consult.daily_room_name}`, { method: 'DELETE' })
  } catch (_) {
    // Room may already be expired/deleted — ignore
  }

  return { consultation: data }
}

async function handleGetStaffToken(body: any, userId: string) {
  const { consultation_id } = body
  if (!consultation_id) throw new Error('Missing consultation_id')

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
serve(async (req) => {
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
```

---

## Daily API Reference (Key Endpoints)

For the agent's reference, here are the exact Daily REST API endpoints used:

| Endpoint | Method | Purpose |
|---|---|---|
| `https://api.daily.co/v1/rooms` | POST | Create a new private room with properties |
| `https://api.daily.co/v1/rooms/{name}` | DELETE | Delete a room (cleanup on end) |
| `https://api.daily.co/v1/meeting-tokens` | POST | Generate a meeting token (owner or participant) |

**Auth for all:** `Authorization: Bearer DAILY_API_KEY` header.

**Room creation body:**
```json
{
  "name": "string (optional, auto-generated if omitted)",
  "privacy": "private",
  "properties": {
    "exp": 1708300000,
    "enable_prejoin_ui": false,
    "enable_chat": true,
    "enable_screenshare": true,
    "max_participants": 4,
    "geo": "eu-west-2"
  }
}
```

**Meeting token body:**
```json
{
  "properties": {
    "room_name": "string (required)",
    "is_owner": true,
    "exp": 1708300000,
    "user_name": "string",
    "enable_screenshare": false
  }
}
```

**Rate limits:** 20 req/s for most endpoints. 2 req/s for DELETE /rooms. More than sufficient for our 1:1 consultation use case.

---

## Supabase Secret

Before deploying, store the Daily API key as a Supabase secret:

```bash
supabase secrets set DAILY_API_KEY=your_daily_api_key_here
```

This is fetched in the edge function via `Deno.env.get('DAILY_API_KEY')`. Never exposed to the client.

---

## Verification Checklist

After completing all work:

- [ ] Migration applies cleanly — `ps_video_consultations` table created, `ps_verify_video_access_code` RPC created
- [ ] `@daily-co/daily-js` installed in `apps/web`
- [ ] Edge function `daily-video` deploys and handles all 4 actions
- [ ] `create_room` action creates a Daily room + tokens + DB record and returns access code
- [ ] `verify_access_code` works publicly (no auth), rate-limited to 5 attempts
- [ ] `end_consultation` updates DB + deletes Daily room
- [ ] `get_staff_token` returns token for auth'd staff
- [ ] `VideoConsultsPage` shows consultation list, "New Consultation" creates a room
- [ ] `VideoRoomPage` renders Daily Prebuilt iframe with staff token, "End Consultation" works
- [ ] `PatientVideoPage` access code entry works, video loads with auto-join (no lobby), patient name pre-filled
- [ ] `PatientVideoPage` shows "Call ended" screen on `left-meeting` event
- [ ] `PatientVideoPage` works on mobile browsers (responsive layout)
- [ ] No typescript errors — `pnpm build` succeeds

---

## Files Modified

| File | Action |
|---|---|
| `supabase/migrations/20260219_video.sql` | **CREATE** |
| `supabase/functions/daily-video/index.ts` | **CREATE** |
| `apps/web/package.json` | **EDIT** — add `@daily-co/daily-js` dependency |
| `apps/web/src/pages/video/VideoConsultsPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/video/VideoRoomPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/video/PatientVideoPage.tsx` | **REPLACE** placeholder |

**DO NOT modify** `App.tsx`, `SideNav.tsx`, or `packages/types/src/index.ts` — Agent 0 handles those.
