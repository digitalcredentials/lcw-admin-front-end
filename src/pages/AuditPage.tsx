import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { listAudit, type AuditEntry } from '../lib/api'

// Anything unrecognised shows its raw action rather than being labelled as one
// of these: an aborted handover shown as a completed one would be worse than
// showing nothing.
const LABELS: Record<string, string> = {
  'account.delete': 'Account deleted',
  'account.delete.aborted': 'Deletion recorded but not applied',
  'account.did.reset': 'Controlling DID reset',
  'account.did.reset.aborted': 'DID reset recorded but not applied',
  'admin.add': 'Admin registered',
  'admin.rekey': 'Admin key changed',
  'admin.remove': 'Admin removed'
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The log is paged. Following the cursor is what makes "everything" true -
  // without it the page would quietly stop at the first hundred records and
  // still claim to show the lot.
  const load = useCallback(async (from?: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await listAudit(from)
      setEntries((existing) => (from ? [...existing, ...result.entries] : result.entries))
      setCursor(result.nextCursor)
    } catch {
      setError('Could not load the activity log.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Layout>
      <h1 className="text-xl font-semibold text-gray-900">Activity</h1>
      <p className="mt-1 text-sm text-gray-500">
        Everything any admin has done, newest first. The log is append-only:
        nothing here can be edited or removed, including by whoever wrote it.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!loading && entries.length === 0 && !error && (
        <p className="mt-4 text-sm text-gray-500">Nothing has been done yet.</p>
      )}

      {entries.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
                <th scope="col" className="px-4 py-3 font-medium">Account</th>
                <th scope="col" className="px-4 py-3 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <tr key={`${entry.targetEmail}-${entry.createdAt}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-500">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    {LABELS[entry.action] ?? entry.action}
                    {entry.detail?.reason && (
                      <span className="block text-xs text-gray-500">
                        “{entry.detail.reason}”
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/account?email=${encodeURIComponent(entry.targetEmail ?? '')}`}
                      className="break-all text-indigo-700 hover:underline"
                    >
                      {entry.targetEmail}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs break-all text-gray-600">
                    {entry.adminEmail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && !loading && (
        <button
          type="button"
          onClick={() => load(cursor)}
          className="mt-4 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Load earlier actions
        </button>
      )}
    </Layout>
  )
}
