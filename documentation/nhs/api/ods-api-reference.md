# NHS ODS API Reference (Organisation Data Service)

> PharmStation internal reference for the NHS ODS API used for GP practice lookups.

## Overview

The **ODS API** is a **public, unauthenticated** REST API provided by NHS Digital for looking up organisation data (GP practices, pharmacies, dental practices, optical sites, hospitals, etc.)

- **Base URL**: `https://directory.spineservices.nhs.uk/ORD/2-0-0`
- **Auth**: None required (fully public)
- **Coverage**: All NHS organisations in England (7000+ GP practices)
- **Format**: JSON (`Accept: application/json`)

## Why We Use This (Not DoHS)

The NHS **Directory of Healthcare Services (DoHS)** (`api.nhs.uk/service-search`) was our initial approach, but the sandbox contains **zero GP practices** — only ~50 dentists. The DoHS also requires a subscription key from the NHS Developer Portal.

The ODS API is free, public, contains all organisations, and works immediately.

## Endpoints

### Search Organisations

```
GET /organisations?Name=X&PrimaryRoleId=RO177&Status=Active&Limit=N
```

**Parameters:**

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `Name` | No* | Organisation name (prefix match, case-insensitive) | `mayfield` |
| `PostCode` | No* | UK postcode (partial outward code OK, e.g. "WV1") | `WV1` or `WV1 2GZ` |
| `PrimaryRoleId` | No | Filter by organisation role | `RO177` |
| `Status` | No | Filter by status | `Active` |
| `Limit` | No | Max results (default varies) | `20` |

*At least one of `Name` or `PostCode` must be provided.

**Response:**
```json
{
  "Organisations": [
    {
      "Name": "MAYFIELD MEDICAL PRACTICE",
      "OrgId": "M92040",
      "Status": "Active",
      "OrgRecordClass": "RC1",
      "PostCode": "WV1 2GZ",
      "LastChangeDate": "2024-07-15",
      "PrimaryRoleId": "RO177",
      "PrimaryRoleDescription": "PRESCRIBING COST CENTRE",
      "OrgLink": "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/M92040"
    }
  ]
}
```

**Note:** Search results do NOT include address, city/town, or phone. Only: Name, OrgId, Status, PostCode, PrimaryRoleId.

### Get Organisation Detail

```
GET /organisations/{ODS_CODE}
```

**Response includes:**
- `Organisation.Name` — e.g. "MAYFIELD MEDICAL PRACTICE" (ALL CAPS)
- `Organisation.GeoLoc.Location.AddrLn1` — Street address
- `Organisation.GeoLoc.Location.AddrLn2` — Additional address line
- `Organisation.GeoLoc.Location.Town` — City/town (ALL CAPS)
- `Organisation.GeoLoc.Location.PostCode` — Full postcode
- `Organisation.Contacts.Contact` — Phone numbers
- `Organisation.Roles.Role` — Array of roles with IDs
- `Organisation.Status` — "Active" / "Inactive"

## Role IDs

| Role ID | Display Name | Use Case |
|---------|-------------|----------|
| **RO177** | Prescribing Cost Centre | **GP Practices** |
| **RO76** | GP Practice | Secondary role on GP practices |
| **RO182** | Pharmacy | Pharmacy sites |
| **RO181** | Pharmacy Headquarter | Pharmacy HQs (e.g. Boots corporate) |
| **RO280** | Pharmacy Site | Pharmacy site locations |
| **RO110** | General Dental Practice | NHS dental practices |
| **RO65** | Private Dental Practice | Private dental |
| **RO167** | Optical Site | Opticians |
| **RO166** | Optical Headquarters | Optical HQs |
| **RO197** | NHS Trust | Hospital trusts |
| **RO272** | Primary Care Network | PCN groupings |

## Limitations

### PostCode Parameter
- ✅ Full postcode: `WV1 2GZ`
- ✅ Partial outward code (3+ chars): `WV1`, `SW1A`
- ❌ Two-char codes: `WV` → returns 406 error
- ❌ Wildcards: `WV*` → returns 406 error ("Supplied PostCode format is invalid")

### City/Town Data
- The search endpoint does **NOT** return city/town data — only Name, OrgId, Status, PostCode
- City data is only available in the individual organisation detail response (`/organisations/{ODS_CODE}`)
- Our edge function does NOT try to enrich or force city data — we return what the API gives us
- The `lookup_ods` action fetches full detail (including city/address) for individual ODS codes

### Name Matching
- `Name` parameter does a **prefix/partial match** (case-insensitive)
- "mayfield" matches "MAYFIELD MEDICAL PRACTICE", "MAYFIELD SURGERY", etc.
- ODS returns names in ALL CAPS — our edge function converts to Title Case

## Example Queries

```bash
# Search all GP practices named "mayfield"
GET /organisations?Name=mayfield&PrimaryRoleId=RO177&Status=Active

# Search GPs in postcode area WV1
GET /organisations?Name=mayfield&PostCode=WV1&PrimaryRoleId=RO177&Status=Active

# Look up specific ODS code
GET /organisations/M92040

# Search pharmacies
GET /organisations?Name=boots&PrimaryRoleId=RO182&Status=Active
```

## PDS Sandbox ↔ ODS Integration

The PDS sandbox returns **fake ODS code `Y12345`** for all test patients' GP practice. This code doesn't exist in the real ODS directory, so GP name resolution fails.

**Our fix:** The `nhs-pds-lookup` edge function (v3+) maps `Y12345` → `M92040` (Mayfield Medical Practice, Wolverhampton) when in sandbox mode, so the downstream ODS lookup resolves a real practice name.

### PDS Sandbox Test NHS Numbers
| NHS Number | Description | GP ODS (raw → mapped) |
|-----------|-------------|----------------------|
| `9000000009` | Standard patient | Y12345 → M92040 |
| `9000000025` | Restricted patient | Y12345 → M92040 |
| `9000000033` | Minimal data patient | May not have GP |

## Edge Function Query Parsing (v6)

Our `nhs-gp-search` edge function v6 parses queries and passes terms straight to the ODS API — no client-side enrichment or filtering.

| User Types | Parsed As | API Call |
|-----------|-----------|---------|
| `mayfield` | Name: "mayfield" | `?Name=mayfield&PrimaryRoleId=RO177` |
| `mayfield surgery` | Name: "mayfield surgery" | `?Name=mayfield+surgery&PrimaryRoleId=RO177` |
| `mayfield WV1` | Name: "mayfield", PostCode: "WV1" | `?Name=mayfield&PostCode=WV1&PrimaryRoleId=RO177` |
| `WV1 2GZ` | PostCode: "WV1 2GZ" | `?PostCode=WV1+2GZ&PrimaryRoleId=RO177` |
| `M92040` | ODS code lookup | `/organisations/M92040` |

The `lookup_ods` action returns full detail (address, city, phone) for a single ODS code.
