# DoS Risk Log — Code Evidence (backend)

Source file (deployed): `supabase/functions/nhs-dos-lookup/index.ts`
Function: `nhs-dos-lookup` — project `xsqwpmqfbirqdncoephf`.

This document collects the **code-reference** evidence for the DoS risks that are
backed by the deployed Edge Function source (as opposed to the live-test evidence
in the Test Evidence PDF, or the config/screenshot evidence).

> Honesty note on scope: the snippets below are the *supplier-side* handling of the
> DoS request/response (validation, live query, pass-through). End-to-end behaviour
> against a **live** DoS response is to be demonstrated at NHS witness testing — no
> live data-returning DoS endpoint is currently available to the supplier.

---

## Risk 008 & 009 — response returned/structure not altered by the connecting system

**What this proves:** `byODSCode` returns the DoS payload in a thin envelope with **no
transformation or re-structuring** — the DoS data itself (`services`) is passed through
verbatim, so the connecting system cannot corrupt the structure or the data.

`nhs-dos-lookup/index.ts` → `handleByOdsCode()`:

```typescript
const data = await dosRes.json()
return successResponse({
  source: IS_SANDBOX ? 'sandbox' : 'live',
  ods_code: cleanOds,
  services: data,          // DoS payload passed through unmodified
})
```

**Caption for PDF:** *Risk 008/009 — the Edge Function wraps the DoS response in a thin
envelope (`{ source, ods_code, services }`) and returns the DoS `data` unmodified. There
is no mapping/transformation layer that could alter the structure or content.*

---

## Risk 010 — complete payload returned (no truncation / field-dropping)

**What this proves:** `byServiceId` and `search` likewise return the **complete** DoS
payload — no field is dropped or truncated by the connecting system.

`nhs-dos-lookup/index.ts` → `handleByServiceId()`:

```typescript
const data = await dosRes.json()
return successResponse({
  source: IS_SANDBOX ? 'sandbox' : 'live',
  service_id: id,
  service: data,           // full DoS service object, no fields dropped
})
```

`nhs-dos-lookup/index.ts` → `handleSearch()`:

```typescript
const data = await dosRes.json()
return successResponse({
  source: IS_SANDBOX ? 'sandbox' : 'live',
  results: data,           // full DoS search results, no truncation
})
```

**Caption for PDF:** *Risk 010 — both `byServiceId` and `search` return the DoS payload in
full (`service` / `results`) with no truncation or field-dropping in the connecting system.*

---

## Risk 012 & 013 — live queries only, no local cache / historic data

**What this proves:** every action performs a **fresh `fetch`** to the configured DoS
endpoint on each call. There is **no local store read or written** anywhere in the
function, so stale-cache and historic-data risks are eliminated by design.

`nhs-dos-lookup/index.ts` → `handleByOdsCode()` (same pattern in `handleByServiceId`/`handleSearch`):

```typescript
const url = `${DOS_BASE}/services/byODSCode/${encodeURIComponent(cleanOds)}`

let dosRes: Response
try {
  dosRes = await fetch(url, { headers: buildHeaders() })   // live request every time
} catch (networkErr: unknown) {
  const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
  return errorResponse(503, 'DOS_UNAVAILABLE', 'Unable to reach DoS API', msg)
}
```

**Caption for PDF:** *Risk 012/013 — each call issues a live `fetch` to the DoS endpoint;
there is no cache read/write in the function, so DoS data is never served from a local
store and cannot become stale.*

---

## Risk 014 — mandatory-field & format validation (server-side, cannot be bypassed)

**What this proves:** required fields are validated **server-side** before any DoS call.
A missing ODS code returns `400 INVALID_REQUEST`; a malformed one returns
`400 INVALID_ODS_CODE`. The client cannot bypass this because it runs in the Edge Function.

> Also covered as a live test (TEST 1 / TEST 2 in the error-handling PDF).

`nhs-dos-lookup/index.ts` → `handleByOdsCode()`:

```typescript
if (!ods_code || typeof ods_code !== 'string' || ods_code.trim().length === 0) {
  return errorResponse(400, 'INVALID_REQUEST', 'Missing or empty required field: ods_code')
}

const cleanOds = ods_code.trim().toUpperCase()

// Basic ODS code format check (3–6 alphanumeric chars)
if (!/^[A-Z0-9]{3,6}$/.test(cleanOds)) {
  return errorResponse(
    400,
    'INVALID_ODS_CODE',
    `Invalid ODS code format: '${cleanOds}'. Expected 3–6 alphanumeric characters.`,
  )
}
```

**Caption for PDF:** *Risk 014 — server-side validation runs before any DoS request:
presence check (`400 INVALID_REQUEST`) and format check (`400 INVALID_ODS_CODE`). Enforced
in the Edge Function, so a client cannot submit an incomplete request.*

---

## Risks 011 & 015 — NOT evidenced by code (presentation layer not yet built)

**Honesty note — read before submitting.** These two risks concern the **presentation
layer** (how DoS data is rendered to the user). A repo-wide search confirms there is
currently **no frontend that consumes `nhs-dos-lookup`** — no DoS response TypeScript
interface, no DoS UI component, and no `functions.invoke('nhs-dos-lookup')` caller. The
DoS feature is pre-launch on the UI side.

Therefore:
- Do **not** cite a frontend file for 011/015 — none exists yet.
- The correct evidence is **"to be demonstrated at NHS witness testing"**, consistent with
  how the other not-yet-live items are worded.
- The current risk-log wording for 011 ("typed TypeScript interfaces for DoS response… UI
  components render all DoS fields") and 015 ("DoS data presented in structured UI with
  human-readable labels") **overclaims** and should be softened to describe the *design
  intent* + witness-testing verification, not an existing implementation.

(See chat: reword proposed for 011 and 015 to remove the implied existing UI.)

---

## Quick risk → evidence-type index (for the PDF contents page)

| Risk | Evidence type | Where |
|------|---------------|-------|
| 001 | Live test | TEST 5/6/7 (auth + audit) |
| 002 | Live test | TEST 5/6 (401) |
| 003, 004, 007 | Live test | TEST 7/10 (audit rows) |
| 005 | Live test | TEST 8 (error codes) |
| 006 | Live test | TEST 9 (error messages) |
| 008, 009 | **Code ref** | this doc → `handleByOdsCode` return |
| 010 | **Code ref** | this doc → `handleByServiceId`/`handleSearch` returns |
| 012, 013 | **Code ref** | this doc → live `fetch`, no cache |
| 014 | **Code ref** + live test | this doc + TEST 1/2 |
| 011, 015 | **Deferred** | witness testing (no UI yet) |
| 016 | Live test | TEST 8 (error-code mapping) |
| 017–021 | Config / screenshot | Vercel + Supabase settings, release checklist |
