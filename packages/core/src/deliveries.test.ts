// Run: node --test --experimental-strip-types packages/core/src/deliveries.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeliveryReminder,
  formatTimeWindow,
  isResolvedStopStatus,
  normalisePhone,
  shouldSendLocation,
  stopAddress,
  stopPostcode,
  toCanvasPoint,
} from './deliveries.ts'

const patient = { address_line_1: '1 Home St', address_line_2: null, city: 'Leeds', postcode: 'LS1 1AA' }

test('stop address uses the override when present, never mixing addresses', () => {
  assert.equal(stopAddress({ patient }), '1 Home St, Leeds, LS1 1AA')
  assert.equal(
    stopAddress({ delivery_address_line_1: 'Flat 2, Care House', delivery_postcode: 'LS2 2BB', patient }),
    'Flat 2, Care House, LS2 2BB',
  )
  assert.equal(stopPostcode({ delivery_address_line_1: 'Work', delivery_postcode: 'M1 1AA', patient }), 'M1 1AA')
  assert.equal(stopPostcode({ patient }), 'LS1 1AA')
})

test('time window from scheduled times', () => {
  assert.equal(formatTimeWindow('10:00:00', '12:30:00'), 'between 10:00 and 12:30')
  assert.equal(formatTimeWindow('9:05', null), 'from 09:05')
  assert.equal(formatTimeWindow(null, '17:00:00'), 'by 17:00')
  assert.equal(formatTimeWindow(null, null), null)
})

test('reminder text', () => {
  const text = buildDeliveryReminder({ firstName: 'Ann', scheduledDate: '2026-11-06', timeStart: '10:00:00', timeEnd: '12:00:00' })
  assert.match(text, /^Hello Ann, your pharmacy will be delivering your medication on Friday 6 November, between 10:00 and 12:00\./)
  assert.match(buildDeliveryReminder({}), /^Your pharmacy will be delivering your medication soon\./)
})

test('phone normalisation matches the SMS function', () => {
  assert.equal(normalisePhone('07700 900123'), '447700900123')
  assert.equal(normalisePhone('+44 7700 900123'), '447700900123')
  assert.equal(normalisePhone('7700900123'), '447700900123')
  assert.equal(normalisePhone('abc'), null)
})

test('resolved statuses', () => {
  assert.equal(isResolvedStopStatus('pending'), false)
  assert.equal(isResolvedStopStatus('delivered'), true)
  assert.equal(isResolvedStopStatus('skipped'), true)
})

test('signature canvas scaling', () => {
  // canvas 376px wide drawn at 188 CSS px: a touch at the middle maps to the middle
  assert.deepEqual(
    toCanvasPoint(110, 60, { left: 16, top: 20, width: 188, height: 80 }, { width: 376, height: 160 }),
    { x: 188, y: 80 },
  )
})

test('GPS throttle: 15 seconds or 50 metres', () => {
  const a = { lat: 51.5, lng: -0.12, at: 0 }
  assert.equal(shouldSendLocation(null, a), true)
  assert.equal(shouldSendLocation(a, { lat: 51.5, lng: -0.12, at: 5000 }), false)
  assert.equal(shouldSendLocation(a, { lat: 51.5, lng: -0.12, at: 15000 }), true)
  assert.equal(shouldSendLocation(a, { lat: 51.5006, lng: -0.12, at: 2000 }), true) // ~67 m
})
