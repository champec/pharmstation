import type { ParseOptions } from './parser.js'

export interface FileSpec {
  /** Logical name for logging. */
  key: string
  /** dm+d XML filename prefix (date suffix varies each release). */
  prefix: string
  /** Target Supabase table. */
  table: string
  /**
   * Primary-key column for upsert. dm+d releases are full weekly snapshots,
   * so upserting on the natural PK keeps invalidated rows (dm+d flags them
   * `invalid=1` rather than deleting). Omit for full-replace tables.
   */
  conflict?: string
  /** If true, delete all existing rows before inserting (snapshot replace). */
  fullReplace?: boolean
  recordTag: string
  fields: Record<string, string>
  context?: ParseOptions['context']
  /** Throw if the file is missing from the release (core tables). */
  required?: boolean
}

/**
 * The dm+d files we load. Element names were verified against the official
 * dm+d XSL transforms and the live Supabase column names.
 */
export const FILE_SPECS: FileSpec[] = [
  {
    key: 'VTM',
    prefix: 'f_vtm',
    table: 'dmd_vtm',
    conflict: 'vtmid',
    recordTag: 'VTM',
    required: true,
    fields: {
      VTMID: 'vtmid',
      INVALID: 'invalid',
      NM: 'nm',
      ABBREVNM: 'abbrevnm',
      VTMIDPREV: 'vtmidprev',
      VTMIDDT: 'vtmiddt',
    },
  },
  {
    key: 'VMP',
    prefix: 'f_vmp',
    table: 'dmd_vmp',
    conflict: 'vpid',
    recordTag: 'VMP',
    required: true,
    fields: {
      VPID: 'vpid',
      VPIDDT: 'vpiddt',
      VPIDPREV: 'vpidprev',
      VTMID: 'vtmid',
      INVALID: 'invalid',
      NM: 'nm',
      ABBREVNM: 'abbrevnm',
      BASISCD: 'basiscd',
      NMDT: 'nmdt',
      NMPREV: 'nmprev',
      BASIS_PREVCD: 'basis_prevcd',
      NMCHANGECD: 'nmchangecd',
      COMBPRODCD: 'combprodcd',
      PRES_STATCD: 'pres_statcd',
      SUG_F: 'sug_f',
      GLU_F: 'glu_f',
      PRES_F: 'pres_f',
      CFC_F: 'cfc_f',
      NON_AVAILCD: 'non_availcd',
      NON_AVAILDT: 'non_availdt',
      DF_INDCD: 'df_indcd',
      UDFS: 'udfs',
      UDFS_UOMCD: 'udfs_uomcd',
      UNIT_DOSE_UOMCD: 'unit_dose_uomcd',
    },
  },
  {
    key: 'VMPP',
    prefix: 'f_vmpp',
    table: 'dmd_vmpp',
    conflict: 'vppid',
    recordTag: 'VMPP',
    required: true,
    fields: {
      VPPID: 'vppid',
      INVALID: 'invalid',
      NM: 'nm',
      ABBREVNM: 'abbrevnm',
      VPID: 'vpid',
      QTYVAL: 'qtyval',
      QTY_UOMCD: 'qty_uomcd',
      COMBPACKCD: 'combpackcd',
    },
  },
  {
    key: 'AMP',
    prefix: 'f_amp2',
    table: 'dmd_amp',
    conflict: 'apid',
    recordTag: 'AMP',
    required: true,
    fields: {
      APID: 'apid',
      INVALID: 'invalid',
      VPID: 'vpid',
      NM: 'nm',
      ABBREVNM: 'abbrevnm',
      DESC: 'desc',
      NMDT: 'nmdt',
      NM_PREV: 'nm_prev',
      SUPPCD: 'suppcd',
      LIC_AUTHCD: 'lic_authcd',
      LIC_AUTH_PREVCD: 'lic_auth_prevcd',
      LIC_AUTHCHANGECD: 'lic_authchangecd',
      LIC_AUTHCHANGEDT: 'lic_authchangedt',
      COMBPRODCD: 'combprodcd',
      FLAVOURCD: 'flavourcd',
      EMA: 'ema',
      PARALLEL_IMPORT: 'parallel_import',
      AVAIL_RESTRICTCD: 'avail_restrictcd',
    },
  },
  {
    key: 'AMPP',
    prefix: 'f_ampp',
    table: 'dmd_ampp',
    conflict: 'appid',
    recordTag: 'AMPP',
    required: true,
    fields: {
      APPID: 'appid',
      INVALID: 'invalid',
      NM: 'nm',
      ABBREVNM: 'abbrevnm',
      VPPID: 'vppid',
      APID: 'apid',
      COMBPACKCD: 'combpackcd',
      LEGAL_CATCD: 'legal_catcd',
      SUBP: 'subp',
      DISCCD: 'disccd',
      DISCDT: 'discdt',
    },
  },
  {
    key: 'INGREDIENT',
    prefix: 'f_ingredient',
    table: 'dmd_ingredient',
    conflict: 'isid',
    recordTag: 'ING',
    required: true,
    fields: {
      ISID: 'isid',
      ISIDDT: 'isiddt',
      ISIDPREV: 'isidprev',
      INVALID: 'invalid',
      NM: 'nm',
    },
  },
  {
    key: 'GTIN',
    prefix: 'f_gtin',
    table: 'dmd_gtin',
    fullReplace: true,
    recordTag: 'GTINDATA',
    required: true,
    context: { tag: 'AMPP', idChild: 'AMPPID', idField: 'appid' },
    fields: {
      GTIN: 'gtin',
      STARTDT: 'startdt',
      ENDDT: 'enddt',
    },
  },
]

/**
 * Second pass over the VMP file: the controlled-drug category lives in the
 * CONTROL_INFO section. We capture VPID + CATCD and write cat_cd onto dmd_vmp,
 * which lets the reconcile step identify Schedule 2-5 CDs.
 */
export const VMP_CONTROL_SPEC = {
  prefix: 'f_vmp',
  recordTag: 'CONTROL_INFO',
  fields: {
    VPID: 'vpid',
    CATCD: 'cat_cd',
  } as Record<string, string>,
}
