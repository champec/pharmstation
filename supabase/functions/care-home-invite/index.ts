import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) return json({ error: 'Unauthorized' }, 401)

    const body = await request.json() as Record<string, unknown>
    const linkId = typeof body.care_home_link_id === 'string' ? body.care_home_link_id : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    if (!linkId || !email || !fullName) return json({ error: 'care_home_link_id, email and full_name are required' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400)

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: link, error: linkError } = await admin
      .from('ps_care_home_links')
      .select('id, pharmacy_organisation_id, care_home_organisation_id, status')
      .eq('id', linkId)
      .maybeSingle()
    if (linkError || !link) return json({ error: 'Care-home link not found' }, 404)
    if (link.status === 'ended') return json({ error: 'This care-home link has ended' }, 409)

    const { data: callerMembership } = await admin
      .from('ps_organisation_members')
      .select('role, permissions, status')
      .eq('organisation_id', link.pharmacy_organisation_id)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()
    const allowedByRole = ['owner', 'manager', 'pharmacist'].includes(callerMembership?.role ?? '')
    const allowedByPermission = callerMembership?.permissions?.care_home_manage === true
    if (!callerMembership || (!allowedByRole && !allowedByPermission)) {
      return json({ error: 'Care-home management permission is required' }, 403)
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, account_type: 'user', default_role: 'carehome_user' },
    })
    if (inviteError || !invited.user) {
      return json({ error: inviteError?.message ?? 'Unable to invite this user' }, 400)
    }

    const invitedUserId = invited.user.id
    const { error: profileError } = await admin
      .from('ps_user_profiles')
      .upsert({ id: invitedUserId, full_name: fullName, email, default_role: 'carehome_user' }, { onConflict: 'id' })
    if (profileError) throw profileError

    const { error: membershipError } = await admin
      .from('ps_organisation_members')
      .upsert({
        organisation_id: link.care_home_organisation_id,
        user_id: invitedUserId,
        role: 'carehome_user',
        permissions: {
          care_home_view: true,
          care_home_requests: true,
          care_home_mar_administer: true,
        },
        status: 'active',
        approved_by: caller.id,
        approved_at: new Date().toISOString(),
      }, { onConflict: 'organisation_id,user_id' })
    if (membershipError) throw membershipError

    const { data: careHomeOrganisation, error: organisationError } = await admin
      .from('ps_organisations')
      .select('auth_user_id')
      .eq('id', link.care_home_organisation_id)
      .single()
    if (organisationError) throw organisationError

    let isOrganisationAdministrator = false
    if (!careHomeOrganisation.auth_user_id) {
      const { error: updateError } = await admin
        .from('ps_organisations')
        .update({ auth_user_id: invitedUserId, updated_at: new Date().toISOString() })
        .eq('id', link.care_home_organisation_id)
        .is('auth_user_id', null)
      if (updateError) throw updateError
      isOrganisationAdministrator = true
    }

    await admin.from('ps_care_home_audit_events').insert({
      care_home_link_id: link.id,
      entity_type: 'ps_organisation_members',
      entity_id: invitedUserId,
      event_type: 'invite',
      summary: `Care-home user invited: ${fullName}`,
      details: { role: 'carehome_user', is_organisation_administrator: isOrganisationAdministrator },
      created_by: caller.id,
    })

    return json({ invited: true, email, is_organisation_administrator: isOrganisationAdministrator }, 201)
  } catch (error) {
    console.error('care-home-invite failed', error)
    return json({ error: error instanceof Error ? error.message : 'Unable to invite care-home user' }, 500)
  }
})