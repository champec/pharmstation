import { getUserClient } from '@pharmstation/supabase-client'

export type ReportStatus = 'draft' | 'ready' | 'submitted' | 'submission_failed'

export interface PatientSafetyReportData {
  step: number
  eventTime: string
  dateCertainty: 'exact' | 'estimated' | 'unknown' | ''
  location: string
  serviceArea: string
  peopleAffected: 'patient' | 'staff' | 'visitor' | 'multiple' | 'none' | ''
  patientReference: string
  patientAge: string
  eventType: string
  description: string
  immediateActions: string
  physicalHarm: string
  psychologicalHarm: string
  currentRisk: 'none' | 'low' | 'moderate' | 'high' | ''
  factors: string[]
  factorDetails: string
  wentWell: string
  learning: string
  followUpOwner: string
  reporterRole: string
  reporterContact: string
  localReference: string
}

export interface PatientSafetyReport {
  id: string
  org_id: string
  created_by: string
  reference: string
  title: string
  status: ReportStatus
  event_date: string | null
  event_type: string | null
  harm_level: string | null
  report_data: PatientSafetyReportData
  lfpse_event_id: string | null
  lfpse_version: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export const emptyReportData = (): PatientSafetyReportData => ({
  step: 0,
  eventTime: '',
  dateCertainty: '',
  location: '',
  serviceArea: '',
  peopleAffected: '',
  patientReference: '',
  patientAge: '',
  eventType: '',
  description: '',
  immediateActions: '',
  physicalHarm: '',
  psychologicalHarm: '',
  currentRisk: '',
  factors: [],
  factorDetails: '',
  wentWell: '',
  learning: '',
  followUpOwner: '',
  reporterRole: '',
  reporterContact: '',
  localReference: '',
})

function asReport(row: Record<string, unknown>): PatientSafetyReport {
  return {
    ...row,
    report_data: { ...emptyReportData(), ...((row.report_data as object | null) ?? {}) },
  } as PatientSafetyReport
}

function makeReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `PS-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
}

export async function listPatientSafetyReports(orgId: string) {
  const { data, error } = await getUserClient()
    .from('ps_patient_safety_reports')
    .select('*')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => asReport(row as Record<string, unknown>))
}

export async function createPatientSafetyReport(orgId: string, userId: string) {
  const reportData = emptyReportData()
  const { data, error } = await getUserClient()
    .from('ps_patient_safety_reports')
    .insert({
      org_id: orgId,
      created_by: userId,
      reference: makeReference(),
      report_data: reportData,
    })
    .select('*')
    .single()

  if (error) throw error
  return asReport(data as Record<string, unknown>)
}

export async function savePatientSafetyReport(
  reportId: string,
  reportData: PatientSafetyReportData,
  status: ReportStatus = 'draft',
) {
  const { data, error } = await getUserClient()
    .from('ps_patient_safety_reports')
    .update({
      title: reportData.description.trim().slice(0, 90) || 'Untitled patient safety report',
      status,
      event_date: reportData.dateCertainty === 'unknown' ? null : reportData.eventTime.slice(0, 10) || null,
      event_type: reportData.eventType || null,
      harm_level: reportData.physicalHarm || null,
      report_data: reportData,
    })
    .eq('id', reportId)
    .select('*')
    .single()

  if (error) throw error
  return asReport(data as Record<string, unknown>)
}

export async function deletePatientSafetyReport(reportId: string) {
  const { error } = await getUserClient()
    .from('ps_patient_safety_reports')
    .delete()
    .eq('id', reportId)

  if (error) throw error
}