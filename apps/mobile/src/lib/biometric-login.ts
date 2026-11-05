// ============================================
// "Sign in with fingerprint / face" for the personal account.
//
// When someone turns it on after a normal sign-in, their email and password
// are saved in the phone's secure hardware (Android Keystore / iOS Keychain)
// with requireAuthentication, so the OS only releases them after a
// fingerprint or face match. Nothing leaves the phone. Two-step sign-in
// (TOTP) still applies on top.
//
// The last email used is remembered separately (not secret) to prefill the
// form. Signing out keeps both; "Turn off" on the sign-in screen removes them.
// ============================================

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

const CRED_KEY = 'ps-biometric-login'
const ENABLED_KEY = 'ps-biometric-login-email'
const EMAIL_KEY = 'ps-last-login-email'

const native = Platform.OS === 'ios' || Platform.OS === 'android'

const secureOptions = (prompt: string): SecureStore.SecureStoreOptions => ({
  requireAuthentication: true,
  authenticationPrompt: prompt,
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
})

/** "Fingerprint", "Face ID" etc., or null if this phone can't do it. */
export async function biometricLabel(): Promise<string | null> {
  if (!native) return null
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'face unlock'
    }
    return Platform.OS === 'ios' ? 'Touch ID' : 'fingerprint'
  } catch {
    return null
  }
}

/** The email biometric sign-in is set up for, if any. */
export async function biometricEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ENABLED_KEY)
  } catch {
    return null
  }
}

export async function rememberedEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(EMAIL_KEY)
  } catch {
    return null
  }
}

export async function rememberEmail(email: string): Promise<void> {
  try {
    await AsyncStorage.setItem(EMAIL_KEY, email.trim())
  } catch {
    // Only a convenience.
  }
}

export async function enableBiometricLogin(email: string, password: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(
      CRED_KEY,
      JSON.stringify({ email: email.trim(), password }),
      secureOptions('Confirm to turn on quick sign-in'),
    )
    await AsyncStorage.setItem(ENABLED_KEY, email.trim())
    return true
  } catch {
    return false
  }
}

/** Ask for the fingerprint/face and return the saved login, or null if cancelled. */
export async function readBiometricLogin(): Promise<{ email: string; password: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(CRED_KEY, secureOptions('Sign in to PharmStation'))
    return raw ? (JSON.parse(raw) as { email: string; password: string }) : null
  } catch {
    return null
  }
}

export async function disableBiometricLogin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CRED_KEY, { keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY })
  } catch {
    // Already gone.
  }
  try {
    await AsyncStorage.removeItem(ENABLED_KEY)
  } catch {
    // Already gone.
  }
}
