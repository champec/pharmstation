# Design Principles

**Last Updated:** February 2026  
**Version:** 1.0

Core UI/UX and engineering principles that all contributors must follow across PharmStation.

---

## 1. Never Use Browser Alerts

**Rule: Never use `window.alert()`, `window.confirm()`, or `window.prompt()` — ever.**

Native browser dialogs are ugly, non-customisable, block the main thread, and look unprofessional. They cannot be styled, do not respect our brand, and create a jarring experience for users.

**Instead, always use:**

- **`<Modal />`** component (`apps/web/src/components/Modal.tsx`) for confirmations, information, and any dialog that requires user attention or input.
- **Inline error/success messages** within forms (e.g. the `auth-error` class or `form-error` class).
- **Toast notifications** (when implemented) for transient feedback.

```tsx
// ❌ NEVER
alert('Entry saved!')
if (confirm('Are you sure?')) { ... }

// ✅ ALWAYS
setSuccessMessage('Entry saved!')
setConfirmModalOpen(true)
```

---

## 2. Full-Page Printing via Popup Windows

**Rule: Never rely on `@media print` CSS on the main page for printing. Always use a popup window approach.**

Hiding page elements with `visibility: hidden` is fragile — sidebars, navs, and layout wrappers leak through. Instead, we open a new blank window, inject only the content we want to print, apply print-specific styles, then trigger `window.print()`.

### Pattern

```tsx
const handlePrint = () => {
  // 1. Grab the HTML of the printable area
  const el = document.getElementById('my-print-area')
  if (!el) return

  // 2. Open a blank popup window
  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  // 3. Write a standalone HTML document with print styles
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print Title</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; }

        /* @page controls paper size, orientation, and margins */
        @page {
          size: A4 landscape;   /* or 'portrait' */
          margin: 5mm 10mm;     /* top/bottom  left/right */
        }

        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>${el.innerHTML}</body>
    </html>
  `)

  // 4. Print and close
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
  printWindow.close()
}
```

### Key @page Tips

- **Orientation**: `size: A4 landscape` or `size: A4 portrait`.
- **Margins**: Use asymmetric margins when needed — `margin: top right bottom left`. For certificates that should fill the page, use small margins like `5mm 10mm`. For tables, `12mm` works well.
- **Fill the page**: Set the content container to `width: 100%; min-height: 100vh` with flexbox centering in the body, so it stretches to the full printable area.
- **Preserve colours**: Always include `-webkit-print-color-adjust: exact; print-color-adjust: exact` so backgrounds and borders render.

### Where This is Used

- **RP Log print** — `RPLogPage.tsx` → `handlePrintLog()` — prints the table in landscape.
- **RP Certificate print** — `RPCertificate.tsx` + `RPLogPage.tsx` / `RPCertificatePage.tsx` — prints the certificate with user-selectable orientation. The card uses `width: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center` to fill the page.
- **Public `/rp` page** — `RPCertificatePage.tsx` — same certificate print for unauthenticated users.

---

## 3. Inline Editing Over Separate Forms

Where data is displayed in a table, prefer Excel-style inline cell editing over opening a separate form/drawer. This reduces context-switching and feels more natural for register-style data entry (pharmacists are used to writing directly into physical registers).

**Key implementation detail**: When using React state for inline edit drafts within TanStack Table columns, store the draft in a `useRef` and read from the ref inside cell renderers. This prevents column recreation on every keystroke (which causes input focus loss).

```tsx
const draftRef = useRef(draft)
draftRef.current = draft

// In column cell renderer:
const d = draftRef.current  // read from ref, not state
```

---

## 4. Correction-Based Editing (Immutable Audit Trail)

Never UPDATE register entries. All edits create a new `correction` entry that references the original via `corrects_entry_id`. This preserves a full, legally-compliant audit trail. The UI shows the latest effective version and provides an "Edited (N)" badge that opens the full version history in a modal.

---

*Add new principles here as they are established.*
