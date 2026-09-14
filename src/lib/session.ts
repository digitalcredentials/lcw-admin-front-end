// The admin's signing key is held in sessionStorage, not localStorage: it is a
// more powerful credential than a wallet holder's, so it should not outlive
// the tab it was entered in. Closing the tab ends the session; reopening the
// console asks for the passphrase again.
const KEY_KEY = 'lcw_admin_session_key'
const DID_KEY = 'lcw_admin_did'
const EMAIL_KEY = 'lcw_admin_email'

export interface AdminSession {
  did: string
  email: string
  exportedKeyPair: object
}

export function getSession(): AdminSession | null {
  const key = sessionStorage.getItem(KEY_KEY)
  const did = sessionStorage.getItem(DID_KEY)
  const email = sessionStorage.getItem(EMAIL_KEY)
  if (!key || !did || !email) {
    return null
  }
  try {
    return { did, email, exportedKeyPair: JSON.parse(key) as object }
  } catch {
    return null
  }
}

export function setSession({ did, email, exportedKeyPair }: AdminSession): void {
  sessionStorage.setItem(KEY_KEY, JSON.stringify(exportedKeyPair))
  sessionStorage.setItem(DID_KEY, did)
  sessionStorage.setItem(EMAIL_KEY, email)
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY_KEY)
  sessionStorage.removeItem(DID_KEY)
  sessionStorage.removeItem(EMAIL_KEY)
}

export function isSignedIn(): boolean {
  return getSession() !== null
}
