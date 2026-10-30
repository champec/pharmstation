import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const NHS_API_URL = 'https://api.nhs.uk/service-search?api-version=2';
// Set as an edge function secret; never hardcode (this repo is public).
const NHS_API_KEY = Deno.env.get('NHS_API_KEY') ?? '';

// ODS codes are alphanumeric; reject anything else so it can't alter the OData filter.
const ODS_CODE_RE = /^[A-Za-z0-9]{3,10}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!NHS_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'NHS_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const odsCode = url.searchParams.get('ods');

    if (!odsCode || !ODS_CODE_RE.test(odsCode)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid ?ods= parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call the NHS Service Search API
    const body = JSON.stringify({
      filter: `OrganisationTypeID eq 'PHA' and OrganisationStatus eq 'Visible' and OrganisationCode eq '${odsCode}'`,
      select: 'OrganisationName,OrganisationCode,Phone,Email,Address1,Address2,Address3,City,County,Postcode,Latitude,Longitude,OpeningTimes,Services,LastUpdatedDate,URL',
      top: 1,
    });

    const nhsRes = await fetch(NHS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'subscription-key': NHS_API_KEY,
      },
      body,
    });

    if (!nhsRes.ok) {
      // Try a broader search without status filter in case pharmacy is not Visible
      const bodyFallback = JSON.stringify({
        filter: `OrganisationTypeID eq 'PHA' and OrganisationCode eq '${odsCode}'`,
        select: 'OrganisationName,OrganisationCode,Phone,Email,Address1,Address2,Address3,City,County,Postcode,Latitude,Longitude,OpeningTimes,Services,LastUpdatedDate,URL',
        top: 1,
      });
      const nhsRes2 = await fetch(NHS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'subscription-key': NHS_API_KEY,
        },
        body: bodyFallback,
      });

      if (!nhsRes2.ok) {
        return new Response(
          JSON.stringify({ error: `NHS API error: ${nhsRes2.status}` }),
          { status: nhsRes2.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const nhsData = await nhsRes2.json();
      return new Response(
        JSON.stringify(normaliseNhsData(nhsData)),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nhsData = await nhsRes.json();
    return new Response(
      JSON.stringify(normaliseNhsData(nhsData)),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

interface NhsApiResponse {
  value?: NhsPharmacy[];
}

interface OpeningTime {
  Weekday?: string;
  OpeningTime?: string;
  ClosingTime?: string;
  IsOpen?: boolean;
  OffsetOpeningTime?: number;
  OffsetClosingTime?: number;
  OpeningTimeType?: string;
  AdditionalOpeningDate?: string;
}

interface NhsPharmacy {
  OrganisationName?: string;
  OrganisationCode?: string;
  Phone?: string;
  Email?: string;
  Address1?: string;
  Address2?: string;
  Address3?: string;
  City?: string;
  County?: string;
  Postcode?: string;
  Latitude?: number;
  Longitude?: number;
  OpeningTimes?: OpeningTime[];
  Services?: unknown[];
  LastUpdatedDate?: string;
  URL?: string;
}

function normaliseNhsData(data: NhsApiResponse) {
  const pharmacy: NhsPharmacy = data?.value?.[0] ?? {};
  if (!pharmacy.OrganisationCode) {
    return { found: false };
  }

  // Normalise opening times — group by weekday vs exception
  const regularHours: Record<string, { open: string; close: string; isOpen: boolean }[]> = {};
  const specialDates: { date: string; open: string; close: string; isOpen: boolean }[] = [];

  for (const slot of (pharmacy.OpeningTimes ?? [])) {
    if (slot.OpeningTimeType === 'General' && slot.Weekday) {
      if (!regularHours[slot.Weekday]) regularHours[slot.Weekday] = [];
      regularHours[slot.Weekday].push({
        open: slot.OpeningTime ?? '',
        close: slot.ClosingTime ?? '',
        isOpen: slot.IsOpen ?? false,
      });
    } else if (slot.OpeningTimeType === 'Additional' && slot.AdditionalOpeningDate) {
      specialDates.push({
        date: slot.AdditionalOpeningDate,
        open: slot.OpeningTime ?? '',
        close: slot.ClosingTime ?? '',
        isOpen: slot.IsOpen ?? false,
      });
    }
  }

  return {
    found: true,
    name: pharmacy.OrganisationName,
    ods_code: pharmacy.OrganisationCode,
    phone: pharmacy.Phone,
    email: pharmacy.Email,
    address: [
      pharmacy.Address1,
      pharmacy.Address2,
      pharmacy.Address3,
      pharmacy.City,
      pharmacy.Postcode,
    ].filter(Boolean).join(', '),
    url: pharmacy.URL,
    last_updated: pharmacy.LastUpdatedDate,
    regular_hours: regularHours,
    special_dates: specialDates,
  };
}
