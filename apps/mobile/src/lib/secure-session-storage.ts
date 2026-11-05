// ============================================
// Session storage for Supabase on mobile, kept in the device's secure
// storage (iOS Keychain / Android Keystore) instead of plain AsyncStorage,
// so a lost or rooted phone doesn't hand over sign-in tokens.
//
// SecureStore values are limited to about 2 KB and a Supabase session is
// bigger, so each value is split into chunks: `${key}__n` holds the chunk
// count and `${key}__0..n-1` the pieces.
//
// Sessions saved by older builds in AsyncStorage are moved across the first
// time they are read, so nobody is signed out by the upgrade.
// On web (Expo web) SecureStore isn't available and AsyncStorage is used.
// ============================================

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const CHUNK_SIZE = 1800
const useSecure = Platform.OS === 'ios' || Platform.OS === 'android'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

/** SecureStore keys may only contain letters, numbers, ".", "-" and "_". */
function safeKey(key: string) {
  return key.replace(/[^A-Za-z0-9._-]/g, '_')
}

async function secureGet(key: string): Promise<string | null> {
  const base = safeKey(key)
  const count = Number(await SecureStore.getItemAsync(`${base}__n`, OPTIONS))
  if (!count) return null
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${base}__${i}`, OPTIONS)
    if (part === null) return null
    parts.push(part)
  }
  return parts.join('')
}

async function secureRemove(key: string) {
  const base = safeKey(key)
  const count = Number(await SecureStore.getItemAsync(`${base}__n`, OPTIONS)) || 0
  await SecureStore.deleteItemAsync(`${base}__n`, OPTIONS)
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${base}__${i}`, OPTIONS)
  }
}

async function secureSet(key: string, value: string) {
  await secureRemove(key)
  const base = safeKey(key)
  const count = Math.ceil(value.length / CHUNK_SIZE) || 1
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(`${base}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), OPTIONS)
  }
  await SecureStore.setItemAsync(`${base}__n`, String(count), OPTIONS)
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!useSecure) return AsyncStorage.getItem(key)
    const value = await secureGet(key)
    if (value !== null) return value
    // One-time move from older builds that used AsyncStorage.
    const legacy = await AsyncStorage.getItem(key)
    if (legacy !== null) {
      await secureSet(key, legacy)
      await AsyncStorage.removeItem(key)
    }
    return legacy
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!useSecure) return AsyncStorage.setItem(key, value)
    await secureSet(key, value)
  },
  async removeItem(key: string): Promise<void> {
    if (!useSecure) return AsyncStorage.removeItem(key)
    await secureRemove(key)
    await AsyncStorage.removeItem(key)
  },
}
