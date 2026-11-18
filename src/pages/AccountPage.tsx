import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import Did from '../components/Did'
import {
  ApiError,
  deleteAccount,
  getAccount,
  type Account,
  type AuditEntry,
  type RemovedRow
} from '../lib/api'
import { download } from '../lib/download'

// Every action the API records, including the corrections it appends when an
// action was recorded and then did not apply. Anything unrecognised shows its
// raw action rather than being labelled as one of these: mislabelling an
// aborted deletion as a completed one would be worse than saying nothing.
const ACTION_LABELS: Record<string, string> = {
  'account.delete': 'Account deleted',
  'account.delete.aborted': 'Deletion recorded but not applied',
  'admin.add': 'Admin registered',
  'admin.rekey': 'Admin key changed',
  'admin.remove': 'Admin removed'
}

// A request that failed without a readable status may or may not have been
// carried out — see the CORS note in lib/api.ts. For a destructive action that
// distinction matters more than any other, so it is never glossed.
function actionFailureMessage(error: unknown, whatItWouldHaveDone: string): string {
  // A failure that is not an ApiError never reached the network at all - a
  // session key that cannot be rehydrated, say - so it is certain that nothing
  // happened, which is the opposite of the status-0 case below.
  if (!(error instanceof ApiError)) {
    return 'The request could not be sent, so nothing was changed. Sign in again and retry.'
  }
  const status = error.status
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
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Only the query parameter changes between two accounts, so this component is
  // never remounted and a slow response for one can land after a newer one.
  const latestRequest = useRef(0)
  const shownEmail = useRef('')

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    setLoading(true)
    setError('')
    // Cleared only when the account being shown changes, so a reload after an
    // action does not blank the page - but a different account never inherits
    // the previous one's details or its armed delete button.
    if (shownEmail.current !== email) {
      shownEmail.current = email
      setAccount(null)
      setHistory([])
      setLoaded(false)
    }
    try {
      const result = await getAccount(email)
      if (request !== latestRequest.current) {
        return
      }
      setAccount(result.account)
      setHistory(result.history)
      setLoaded(true)
    } catch (err) {
      if (request !== latestRequest.current) {
        return
      }
      setError(
        err instanceof ApiError && err.status === 0
          ? 'Could not reach the admin API. This account may still exist — nothing here is up to date.'
          : 'Could not load this account.'
      )
    } finally {
      if (request === latestRequest.current) {
        setLoading(false)
      }
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

      {/* The API answers 404 for any email it has no row for, deleted or never
          registered, so the deletion banner follows the log rather than the
          absence: only a recorded deletion carries the row that restores it. */}
      {loaded && !account && history.some((entry) => entry.detail?.removed) && (
        <p className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          This account no longer exists. Its history is below, and it includes
          the row that was removed — putting that row back lets the account sign
          in again.
        </p>
      )}

      {loaded && !account && !history.some((entry) => entry.detail?.removed) && (
        <p className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No wallet account is registered for this address.
          {history.length > 0 && ' The entries below mention it, but none of them removed an account.'}
        </p>
      )}

      {account && (
        <>
          <dl className="mt-6 grid gap-4 rounded-2xl border border-gray-200 bg-white p-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                Account DID
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
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                Contact me with news and updates
              </dt>
              <dd className="mt-1 text-sm text-gray-700">
                {account.contactOptIn
                  ? `Agreed${account.contactOptInUpdatedAt ? ` on ${new Date(account.contactOptInUpdatedAt).toLocaleDateString()}` : ''}`
                  : 'Not agreed'}
              </dd>
            </div>
          </dl>

          {/* Keyed by account, so switching accounts resets what is typed into
              it rather than carrying it across. */}
          <DeletePanel
            key={`delete-${account.email}`}
            account={account}
            onDeleted={() => navigate('/accounts')}
          />
        </>
      )}

      <History entries={history} known={loaded} />
    </Layout>
  )
}

function DeletePanel({ account, onDeleted }: { account: Account; onDeleted: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [removed, setRemoved] = useState<RemovedRow | null>(null)

  async function submit() {
    setBusy(true)
    setError('')
    let result
    try {
      result = await deleteAccount(account.email)
    } catch (err) {
      setError(actionFailureMessage(err, 'the account was deleted'))
      setBusy(false)
      return
    }

    // Past this point the deletion is confirmed, so nothing below may report
    // it as uncertain. The removed row is the means of undoing it, so if the
    // download cannot be started the row is put on screen instead of lost.
    try {
      download(`${account.email}-account-record.json`, JSON.stringify(result.deleted, null, 2), 'application/json')
      onDeleted()
    } catch {
      setRemoved(result.deleted)
      setBusy(false)
    }
  }

  if (removed) {
    return (
      <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <h2 className="font-semibold text-amber-900">
          Account deleted — save this row
        </h2>
        <p className="mt-1 text-sm text-amber-900">
          The account was removed, but the file could not be downloaded. This is
          the row that restores it; it is also in the activity log.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-3 text-xs text-gray-800">
          {JSON.stringify(removed, null, 2)}
        </pre>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">Delete this account</h2>
      <p className="mt-1 text-sm text-gray-600">
        Removes the account row, which is what lets this person sign in to the
        wallet. Their storage and the credentials in it are{' '}
        <span className="font-medium">not</span> touched — this console has no
        access to them at all, and they stay under the account&apos;s own keys.
        The removed row is recorded, and downloaded to you, so the account can
        be put back exactly as it was.
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

function History({ entries, known }: { entries: AuditEntry[]; known: boolean }) {
  // "Nobody has acted on this account" is a claim about the log, and a load
  // that failed read no log at all.
  if (!known) {
    return (
      <section className="mt-6">
        <h2 className="font-semibold text-gray-900">History</h2>
        <p className="mt-1 text-sm text-gray-500">
          Not read — the admin API could not be reached.
        </p>
      </section>
    )
  }

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
