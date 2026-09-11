import { Ed25519VerificationKey } from '@interop/ed25519-verification-key'
import { Ed25519Signature2020 } from '@interop/ed25519-signature'
import { ZcapClient } from '@interop/ezcap'
import { getSession } from './session'

export interface Account {
  email: string
  did: string
  spaceURL?: string
  createdAt?: string
}

export interface AuditEntry {
  targetEmail?: string
  createdAt: string
  action: string
  adminDid: string
  adminEmail: string
  detail?: {
    previousDid?: string
    newDid?: string
    reason?: string
    removed?: Account
  }
}

export interface AdminIdentity {
  verified: boolean
  did: string
  email: string
  name?: string
}

export class ApiError extends Error {
  status: number
  // The parsed JSON body, when the response had one. A refused request that the
  // browser could not read at all (see below) has neither status nor data.
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

const base = (import.meta.env.VITE_ADMIN_API_BASE_URL ?? '').replace(/\/+$/, '')

// The admin key pair is derived from the passphrase exactly as the wallet
// derives a holder's: SHA-256(passphrase) as the 32-byte Ed25519 seed, so the
// same passphrase always yields the same did:key. The DID registered in the
// admin table must have been derived the same way.
export async function deriveKeyPair(passphrase: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase))
  const keyPair = await Ed25519VerificationKey.generate({ seed: new Uint8Array(digest) })
  keyPair.controller = `did:key:${keyPair.fingerprint()}`
  keyPair.id = `${keyPair.controller}#${keyPair.fingerprint()}`
  return keyPair
}

// An account's email goes into the URL path as it is, with only genuinely
// unsafe characters encoded. '@' and '+' are legal in a path segment, and both
// ends must agree on the exact bytes because the signature covers the request
// target: API Gateway passes the path through untouched while sam local
// decodes it first, so an encoded '@' would verify against the deployed API
// and fail against the local one.
export function pathSegment(email: string): string {
  return encodeURIComponent(email).replace(/%40/g, '@').replace(/%2B/gi, '+')
}

function clientFor(keyPair: Ed25519VerificationKey) {
  return new ZcapClient({
    SuiteClass: Ed25519Signature2020,
    invocationSigner: keyPair.signer()
  })
}

// Signs one request. Every call to the admin API is signed this way - there is
// no token to send and no session on the server - so the key is needed for
// each one, and a request the caller is not entitled to make is refused by the
// API rather than merely hidden by this console.
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  json?: object,
  keyPairOverride?: Ed25519VerificationKey
): Promise<T> {
  let keyPair = keyPairOverride
  if (!keyPair) {
    const session = getSession()
    if (!session) {
      throw new ApiError(401, 'Not signed in.')
    }
    keyPair = await Ed25519VerificationKey.from(session.exportedKeyPair)
  }

  try {
    const response = await clientFor(keyPair).request({
      url: `${base}${path}`,
      method,
      ...(json === undefined ? {} : { json })
    })
    return response.data as T
  } catch (error) {
    // A refused request arrives here as a network error rather than a status
    // when the response carries no CORS headers, which is what `sam local`
    // does with an authorizer denial - the browser will not let the page read
    // the 403 at all. So status 0 means "refused or unreachable, cannot tell",
    // and callers have to phrase themselves accordingly.
    const status = (error as { status?: number }).status ?? 0
    const data = (error as { data?: unknown }).data
    const message =
      (data as { error?: string } | undefined)?.error ??
      (error as Error).message ??
      'Request failed.'
    throw new ApiError(status, message, data)
  }
}

// Confirms who the caller is. The API has no login in the usual sense: this
// route returns the identity the signature proved, and nothing is issued.
export function whoami(keyPair: Ed25519VerificationKey): Promise<AdminIdentity> {
  return request<AdminIdentity>('POST', '/login', {}, keyPair)
}

export function listAccounts(options: { query?: string; cursor?: string } = {}) {
  const params = new URLSearchParams()
  if (options.query) params.set('q', options.query)
  if (options.cursor) params.set('cursor', options.cursor)
  const suffix = params.toString() ? `?${params}` : ''
  return request<{ accounts: Account[]; nextCursor?: string }>('GET', `/accounts${suffix}`)
}

export type AccountDetail = { account: Account | null; history: AuditEntry[] }

// A deleted account answers 404, but with its history - which holds the row
// that was removed, and so the means of restoring it. That body is the point
// of the request, not an error to discard.
export async function getAccount(email: string): Promise<AccountDetail> {
  try {
    return await request<AccountDetail>('GET', `/accounts/${pathSegment(email)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.data) {
      return error.data as AccountDetail
    }
    throw error
  }
}

export function resetDid(email: string, did: string, reason?: string) {
  return request<{ email: string; did: string; previousDid?: string; unchanged?: boolean }>(
    'PUT',
    `/accounts/${pathSegment(email)}/did`,
    { did, ...(reason ? { reason } : {}) }
  )
}

export function deleteAccount(email: string) {
  return request<{ deleted: Account; note: string }>(
    'DELETE',
    `/accounts/${pathSegment(email)}`
  )
}

export function listAudit() {
  return request<{ entries: AuditEntry[] }>('GET', '/audit')
}
