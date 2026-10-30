import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLATFORM_FEE_PENCE = 50; // 50p per completed shift

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Last Mon–Sun relative to any given date */
function lastWeekRange(from: Date): { weekStart: string; weekEnd: string } {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  // Last Sunday = today minus "day" days, unless today is Sunday then minus 7
  const backToSunday = day === 0 ? 7 : day;
  const lastSunday = new Date(d);
  lastSunday.setDate(d.getDate() - backToSunday);
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  return { weekStart: isoDate(lastMonday), weekEnd: isoDate(lastSunday) };
}

Deno.serve(async (req: Request) => {
  try {
    // Service-role client — bypasses RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Determine week range
    let weekStart: string;
    let weekEnd: string;
    const body = await req.json().catch(() => ({}));
    if (body.week_start && body.week_end) {
      weekStart = body.week_start;
      weekEnd = body.week_end;
    } else {
      const r = lastWeekRange(new Date());
      weekStart = r.weekStart;
      weekEnd = r.weekEnd;
    }

    const today = isoDate(new Date());
    // Due date = invoiced Wednesday + 2 days = Friday
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    const dueDateStr = isoDate(dueDate);

    // ---- Step 1: Shifts in the week -------------------------------------------
    const { data: shifts, error: sErr } = await supabase
      .from('ps_locum_shifts')
      .select('id, date, start_time, end_time, rate_per_hour, org_id')
      .gte('date', weekStart)
      .lte('date', weekEnd);
    if (sErr) throw new Error(`shifts query: ${sErr.message}`);
    if (!shifts || shifts.length === 0) {
      return new Response(JSON.stringify({ ok: true, invoicesCreated: 0, message: 'No shifts in range', weekStart, weekEnd }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shiftIds = shifts.map((s: Record<string, unknown>) => s.id as string);
    const shiftMap = new Map(shifts.map((s: Record<string, unknown>) => [s.id as string, s]));

    // ---- Step 2: Completed bookings for those shifts --------------------------
    const { data: bookings, error: bErr } = await supabase
      .from('ps_locum_bookings')
      .select('id, shift_id, locum_id, org_id')
      .in('shift_id', shiftIds)
      .eq('status', 'completed');
    if (bErr) throw new Error(`bookings query: ${bErr.message}`);
    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ ok: true, invoicesCreated: 0, message: 'No completed bookings in range', weekStart, weekEnd }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ---- Step 3: Group by (org_id, locum_id) ----------------------------------
    type BookingWithShift = { bookingId: string; shift: Record<string, unknown> };
    const groups = new Map<string, { orgId: string; locumId: string; bookings: BookingWithShift[] }>();
    for (const b of bookings as Record<string, string>[]) {
      const shift = shiftMap.get(b.shift_id);
      if (!shift) continue;
      const key = `${b.org_id}|${b.locum_id}`;
      if (!groups.has(key)) groups.set(key, { orgId: b.org_id, locumId: b.locum_id, bookings: [] });
      groups.get(key)!.bookings.push({ bookingId: b.id, shift });
    }

    // ---- Step 4: Current invoice count (for sequential numbering) -------------
    const { count: existingCount } = await supabase
      .from('ps_locum_invoices')
      .select('id', { count: 'exact', head: true });
    let invoiceSeq = (existingCount ?? 0) + 1;

    const year = new Date().getFullYear();
    const results: string[] = [];
    const skipped: string[] = [];

    // ---- Step 5: Create invoice per group -------------------------------------
    for (const [key, group] of groups) {
      // Skip if invoice already exists for this week + org + locum
      const { data: existing } = await supabase
        .from('ps_locum_invoices')
        .select('id')
        .eq('org_id', group.orgId)
        .eq('locum_id', group.locumId)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (existing) { skipped.push(key); continue; }

      // Upsert payment week
      const { data: pw, error: pwErr } = await supabase
        .from('ps_locum_payment_weeks')
        .upsert({ org_id: group.orgId, locum_id: group.locumId, week_start: weekStart, week_end: weekEnd, status: 'pending' }, { onConflict: 'org_id,locum_id,week_start' })
        .select('id')
        .single();
      if (pwErr) { console.error('payment_week upsert', pwErr); continue; }

      // Build line items
      type LineItem = {
        booking_id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        duration_minutes: number;
        rate_per_hour: number;
        line_total_pence: number;
        platform_fee_pence: number;
      };
      const lines: LineItem[] = [];
      for (const { bookingId, shift } of group.bookings) {
        const [sh, sm] = (shift.start_time as string).split(':').map(Number);
        const [eh, em] = (shift.end_time as string).split(':').map(Number);
        const duration_minutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        const rate = Number(shift.rate_per_hour);
        const line_total_pence = Math.round((duration_minutes / 60) * rate * 100);
        lines.push({
          booking_id: bookingId,
          shift_date: shift.date as string,
          start_time: shift.start_time as string,
          end_time: shift.end_time as string,
          duration_minutes,
          rate_per_hour: rate,
          line_total_pence,
          platform_fee_pence: PLATFORM_FEE_PENCE,
        });
      }

      const subtotal_pence = lines.reduce((s, l) => s + l.line_total_pence, 0);
      const total_platform_fee = lines.length * PLATFORM_FEE_PENCE;
      const total_pence = subtotal_pence; // locum receives subtotal; org pays subtotal + fee separately or fee is deducted
      const invoiceNumber = `INV-${year}-${String(invoiceSeq).padStart(6, '0')}`;

      // Insert invoice
      const { data: invoice, error: iErr } = await supabase
        .from('ps_locum_invoices')
        .insert({
          payment_week_id: pw.id,
          org_id: group.orgId,
          locum_id: group.locumId,
          invoice_number: invoiceNumber,
          week_start: weekStart,
          week_end: weekEnd,
          issued_at: today,
          due_date: dueDateStr,
          subtotal_pence,
          platform_fee_pence: total_platform_fee,
          total_pence,
          status: 'pending',
        })
        .select('id')
        .single();
      if (iErr) { console.error('invoice insert', iErr); continue; }

      // Insert line items
      const { error: liErr } = await supabase
        .from('ps_locum_invoice_lines')
        .insert(lines.map((l) => ({ ...l, invoice_id: invoice.id })));
      if (liErr) console.error('invoice lines insert', liErr);

      results.push(invoiceNumber);
      invoiceSeq++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        weekStart,
        weekEnd,
        invoicesCreated: results.length,
        invoiceNumbers: results,
        skipped: skipped.length,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('generate-weekly-invoices error', err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
