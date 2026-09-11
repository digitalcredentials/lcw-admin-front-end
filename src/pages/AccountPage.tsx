import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import Did from '../components/Did'
import {
  deleteAccount,
  deriveKeyPair,
  getAccount,
  resetDid,
  type Account,
  type AuditEntry
} from '../lib/api'

const DID_KEY_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/

export default function AccountPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const email = params.get('email') ?? ''

  const [account, setAccount] = useState<Account | null>(null)
  const [history, setHistory] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getAccount(email)
      setAccount(result.account)
      setHistory(result.history)
    } catch {
      setError('Could not load this account.')
    } finally {
      setLoading(false)
    }
  }, [email])

  useEffect(() => {
    if (email) load()
  }, [email, load])

  return (
    <Layout>
      <Link to="/accounts" className="text-sm text-indigo-700 hover:underline">
        ← All accounts
      </Link>

      <h1 className="mt-3 text-xl font-semibold break-all text-gray-900">{email}</h1>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!loading && !account && (
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

          <ResetDidPanel account={account} onDone={load} />
          <DeletePanel account={account} onDeleted={() => navigate('/accounts')} />
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

  // Derived here rather than anywhere else: a passphrase typed into this box
  // stays in this browser, and only the resulting public DID is sent.
  useEffect(() => {
    let current = true
    if (mode !== 'derive' || !passphrase) {
      setDerivedDid('')
      return
    }
    deriveKeyPair(passphrase).then((keyPair) => {
      if (current) setDerivedDid(keyPair.controller as string)
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
      setDid('')
      setPassphrase('')
      setReason('')
      onDone()
    } catch (err) {
      setError((err as Error).message)
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
      setError((err as Error).message)
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
                {entry.action === 'account.delete' ? 'Account deleted' : 'Controlling DID reset'}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-gray-600">
              by {entry.adminEmail || 'an admin'}{' '}
              <span className="font-mono text-xs text-gray-400">{entry.adminDid}</span>
            </p>
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

function download(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
