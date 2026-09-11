import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import Did from '../components/Did'
import {
  ApiError,
  deleteAccount,
  deriveKeyPair,
  getAccount,
  resetDid,
  type Account,
  type AuditEntry
} from '../lib/api'

const DID_KEY_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/

// Every action the API records, including the corrections it appends when an
// action was recorded and then did not apply. Anything unrecognised shows its
// raw action rather than being labelled as one of these: mislabelling an
// aborted handover as a completed one would be worse than saying nothing.
const ACTION_LABELS: Record<string, string> = {
  'account.delete': 'Account deleted',
  'account.delete.aborted': 'Deletion recorded but not applied',
  'account.did.reset': 'Controlling DID reset',
  'account.did.reset.aborted': 'DID reset recorded but not applied',
  'admin.add': 'Admin registered',
  'admin.rekey': 'Admin key changed',
  'admin.remove': 'Admin removed'
}

// A request that failed without a readable status may or may not have been
// carried out — see the CORS note in lib/api.ts. For a destructive action that
// distinction matters more than any other, so it is never glossed.
function actionFailureMessage(error: unknown, whatItWouldHaveDone: string): string {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 0) {
    return `The request could not be read back, so it is not possible to tell whether ${whatItWouldHaveDone}. Reload this page before trying again.`
  }
  if (status === 409) {
    return 'This account changed while the request was in flight, so nothing was done. Reload and try again.'
  }
  return error instanceof Error ? error.message : 'The request failed.'
}

export default function AccountPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const email = params.get('email') ?? ''

  const [account, setAccount] = useState<Account | null>(null)
  const [history, setHistory] = useState<AuditEntry[]>([])
  const [deleted, setDeleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    // Cleared before the request, so a slow load never shows one account's
    // details - or its armed delete button - under another's heading.
    setAccount(null)
    setHistory([])
    setDeleted(false)
    try {
      const result = await getAccount(email)
      setAccount(result.account)
      setHistory(result.history)
      // The API answers 404 with the account's history when it has been
      // deleted. Only that is a deletion; a request that failed is not.
      setDeleted(result.account === null)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? 'Could not reach the admin API. This account may still exist — nothing here is up to date.'
          : 'Could not load this account.'
      )
    } finally {
      setLoading(false)
    }
  }, [email])

  useEffect(() => {
    if (email) load()
  }, [email, load])

  if (!email) {
    return (
      <Layout>
        <p className="text-sm text-gray-600">
          No account given.{' '}
          <Link to="/accounts" className="text-indigo-700 hover:underline">
            Pick one from the list.
          </Link>
        </p>
      </Layout>
    )
  }

  return (
    <Layout>
      <Link to="/accounts" className="text-sm text-indigo-700 hover:underline">
        ← All accounts
      </Link>

      <h1 className="mt-3 text-xl font-semibold break-all text-gray-900">{email}</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}{' '}
          <button type="button" onClick={load} className="font-medium underline">
            Retry
          </button>
        </p>
      )}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {deleted && (
        <p className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          This account no longer exists. Its history is below, and it includes
          the row that was removed — putting that row back restores the account
          and its access to its space.
        </p>
      )}

      {account && (
        <>
          <dl className="mt-6 grid gap-4 rounded-2xl border border-gray-200 bg-white p-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                Controlling DID
              </dt>
              <dd className="mt-1">
                <Did value={account.did} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                Registered
              </dt>
              <dd className="mt-1 text-sm text-gray-700">
                {account.createdAt ? new Date(account.createdAt).toLocaleString() : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                Storage space
              </dt>
              <dd className="mt-1 text-sm break-all text-gray-700">
                {account.spaceURL ?? '—'}
              </dd>
            </div>
          </dl>

          {/* Keyed by account, so switching accounts resets what is typed into
              them rather than carrying it across. */}
          <ResetDidPanel key={`reset-${account.email}`} account={account} onDone={load} />
          <DeletePanel
            key={`delete-${account.email}`}
            account={account}
            onDeleted={() => navigate('/accounts')}
          />
        </>
      )}

      <History entries={history} />
    </Layout>
  )
}

function ResetDidPanel({ account, onDone }: { account: Account; onDone: () => void }) {
  const [mode, setMode] = useState<'paste' | 'derive'>('paste')
  const [did, setDid] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [derivedDid, setDerivedDid] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [handover, setHandover] = useState<{ passphrase: string; did: string } | null>(null)

  // Derived here rather than anywhere else: a passphrase typed into this box
  // stays in this browser, and only the resulting public DID is sent.
  useEffect(() => {
    let current = true
    if (mode !== 'derive' || !passphrase) {
      setDerivedDid('')
      return
    }
    deriveKeyPair(passphrase)
      .then((keyPair) => {
        if (current) setDerivedDid(keyPair.controller as string)
      })
      .catch(() => {
        if (current) {
          setDerivedDid('')
          setError('Could not derive a key from that passphrase.')
        }
      })
    return () => {
      current = false
    }
  }, [mode, passphrase])

  const chosenDid = mode === 'paste' ? did.split('#')[0].trim() : derivedDid
  const valid = DID_KEY_PATTERN.test(chosenDid)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await resetDid(account.email, chosenDid, reason)
      // The admin-chosen passphrase is the credential the account holder now
      // needs. It is kept on screen until dismissed rather than cleared on
      // success, which would destroy it at the moment it starts to matter.
      if (mode === 'derive') {
        setHandover({ passphrase, did: chosenDid })
      }
      setDid('')
      setPassphrase('')
      setReason('')
      onDone()
    } catch (err) {
      setError(actionFailureMessage(err, 'the DID was changed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">Reset the controlling DID</h2>
      <p className="mt-1 text-sm text-gray-600">
        This hands the account over. Whoever holds the new key can sign in as
        this person and open everything in their storage space, immediately.
        The change is recorded against your name, and the current DID is kept so
        it can be undone.
      </p>

      {handover && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            Give {account.email} this passphrase, then forget it.
          </p>
          <p className="mt-2 font-mono text-base break-all text-amber-900">
            {handover.passphrase}
          </p>
          <p className="mt-2 font-mono text-xs break-all text-amber-800">
            {handover.did}
          </p>
          <button
            type="button"
            onClick={() => setHandover(null)}
            className="mt-3 text-xs font-medium text-amber-900 underline"
          >
            I have passed it on — hide it
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="reset-mode"
            checked={mode === 'paste'}
            onChange={() => setMode('paste')}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-gray-800">
              Use a DID the account holder generated
            </span>
            <span className="block text-gray-500">
              They keep their passphrase; you only ever see the public DID.
            </span>
          </span>
        </label>

        {mode === 'paste' && (
          <input
            type="text"
            value={did}
            onChange={(e) => setDid(e.target.value)}
            placeholder="did:key:z6Mk…"
            aria-label="New controlling DID"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="reset-mode"
            checked={mode === 'derive'}
            onChange={() => setMode('derive')}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-gray-800">
              Choose a passphrase on their behalf
            </span>
            <span className="block text-gray-500">
              For when they cannot generate a DID themselves. You will be
              holding a credential that opens their wallet — hand it over by a
              channel you trust, and do not keep it.
            </span>
          </span>
        </label>

        {mode === 'derive' && (
          <div className="space-y-2">
            <input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="A passphrase to give the account holder"
              aria-label="Passphrase for the account holder"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            {derivedDid && (
              <p className="text-xs text-gray-500">
                Derives <span className="font-mono break-all">{derivedDid}</span>
              </p>
            )}
          </div>
        )}

        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why (recorded alongside the change)"
          aria-label="Reason for the reset"
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />

        {chosenDid && !valid && (
          <p className="text-sm text-amber-700">
            That is not an Ed25519 <span className="font-mono">did:key</span>.
            A mistyped DID would hand the account to a key nobody holds.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!valid || busy || chosenDid === account.did}
          onClick={submit}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Resetting…' : 'Reset controlling DID'}
        </button>
      </div>
    </section>
  )
}

function DeletePanel({ account, onDeleted }: { account: Account; onDeleted: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const result = await deleteAccount(account.email)
      // The removed row, handed to the admin who removed it. Restoring it is
      // what undoes this, so it should not only live in the audit table.
      download(`${account.email}-account-record.json`, JSON.stringify(result.deleted, null, 2))
      onDeleted()
    } catch (err) {
      setError(actionFailureMessage(err, 'the account was deleted'))
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">Delete this account</h2>
      <p className="mt-1 text-sm text-gray-600">
        Removes the account row, which is what lets this person sign in and what
        proves they control their space. Their space and the credentials in it
        are <span className="font-medium">not</span> touched — this console has
        no access to them at all. The removed row is recorded, and downloaded to
        you, so the account can be put back exactly as it was.
      </p>

      <div className="mt-4 space-y-3">
        <label htmlFor="confirm-email" className="block text-sm text-gray-700">
          Type <span className="font-mono">{account.email}</span> to confirm
        </label>
        <input
          id="confirm-email"
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none"
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={confirmation !== account.email || busy}
          onClick={submit}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </section>
  )
}

function History({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="font-semibold text-gray-900">History</h2>
        <p className="mt-1 text-sm text-gray-500">
          No admin has acted on this account.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-6">
      <h2 className="font-semibold text-gray-900">History</h2>
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li
            key={`${entry.createdAt}-${entry.action}`}
            className="rounded-2xl border border-gray-200 bg-white p-4 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-gray-900">
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-gray-600">
              by {entry.adminEmail || 'an admin'}{' '}
              <span className="font-mono text-xs text-gray-400">{entry.adminDid}</span>
            </p>
            {entry.detail?.why && (
              <p className="mt-1 text-gray-600">{entry.detail.why}</p>
            )}
            {entry.detail?.previousDid && (
              <p className="mt-2 font-mono text-xs break-all text-gray-500">
                {entry.detail.previousDid} → {entry.detail.newDid}
              </p>
            )}
            {entry.detail?.reason && (
              <p className="mt-1 text-gray-600">“{entry.detail.reason}”</p>
            )}
            {entry.detail?.removed && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-indigo-700">
                  The removed row
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                  {JSON.stringify(entry.detail.removed, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// The anchor is attached to the document before it is clicked, and the object
// URL outlives the click: a detached anchor or a synchronously revoked URL
// works in Chromium and silently does nothing in some other browsers - and
// this is the only copy of a row that has just been deleted.
function download(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 30_000)
}
