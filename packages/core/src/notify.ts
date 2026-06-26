// ============================================
// PharmStation — reusable notification helpers ("plug & play")
//
// A thin, feature-tagged wrapper over the messaging store's `notify`
// action so ANY feature can send a patient an SMS / email / letter
// through the org's own NHS Notify account with a single call.
//
// Example:
//   await psNotify.videoLink({
//     orgId, patientId, to: '+447700900000',
//     link: 'https://app/consult/abc', when: 'today at 2:00pm',
//   })
//
// All sends are logged to ps_messages (tagged with `feature`) and their
// delivery/failure status is tracked via the nhs-notify-callback.
// ============================================

import type { MessageChannel } from '@pharmstation/types'
import { useMessagingStore, type NotifyParams } from './stores/messaging-store'

/** Common identity for a functional send. Provide `to`/`address`, or a `patientId` to resolve from the patient record. */
interface Target {
  orgId: string
  patientId?: string
  /** phone (sms) or email address (email); optional when patientId is given */
  to?: string
  /** GOV.UK Notify address lines (letter); optional when patientId is given */
  address?: Record<string, string>
  channel?: MessageChannel
}

function fire(params: NotifyParams) {
  return useMessagingStore.getState().notify(params)
}

export const psNotify = {
  /** Lowest-level escape hatch — pass any NotifyParams directly. */
  send: fire,

  /** Appointment booking confirmation. */
  appointmentBooked(t: Target & { when: string; serviceName?: string }) {
    return fire({
      org_id: t.orgId, channel: t.channel ?? 'sms', patient_id: t.patientId,
      to: t.to, address: t.address, feature: 'appointment',
      subject: 'Appointment confirmation',
      body: `Your ${t.serviceName ?? 'appointment'} is booked for ${t.when}. Please contact us if you need to rearrange.`,
    })
  },

  /** Appointment reminder (e.g. day before). */
  appointmentReminder(t: Target & { when: string; serviceName?: string }) {
    return fire({
      org_id: t.orgId, channel: t.channel ?? 'sms', patient_id: t.patientId,
      to: t.to, address: t.address, feature: 'reminder',
      subject: 'Appointment reminder',
      body: `Reminder: your ${t.serviceName ?? 'appointment'} is on ${t.when}.`,
    })
  },

  /** Video consultation link + (optional) access code. */
  videoLink(t: Target & { link: string; when?: string; accessCode?: string }) {
    const whenPart = t.when ? ` on ${t.when}` : ''
    const codePart = t.accessCode ? ` Access code: ${t.accessCode}.` : ''
    return fire({
      org_id: t.orgId, channel: t.channel ?? 'sms', patient_id: t.patientId,
      to: t.to, address: t.address, feature: 'video',
      subject: 'Your video consultation',
      body: `Your video consultation${whenPart} is ready. Join here: ${t.link}.${codePart}`,
    })
  },

  /** Urgent / ad-hoc alert with a custom body. */
  urgent(t: Target & { body: string; subject?: string }) {
    return fire({
      org_id: t.orgId, channel: t.channel ?? 'sms', patient_id: t.patientId,
      to: t.to, address: t.address, feature: 'urgent',
      subject: t.subject ?? 'Urgent message from your pharmacy', body: t.body,
    })
  },
}

export type PsNotify = typeof psNotify
