import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import Did from '../components/Did'
import { listAccounts, type Account } from '../lib/api'

export default function AccountsPage() {
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Searching races: each keystroke starts a request, and a slower earlier one
  // must not land after a newer one and leave the list showing results for a
  // query nobody typed any more - with a cursor belonging to that older query.
  const latestRequest = useRef(0)

  const load = useCallback(async (search: string, from?: string) => {
    const request = ++latestRequest.current
    setLoading(true)
    setError('')
    try {
      const result = await listAccounts({ query: search, cursor: from })
      if (request !== latestRequest.current) {
        return
      }
      setAccounts((existing) => (from ? [...existing, ...result.accounts] : result.accounts))
      setCursor(result.nextCursor)
    } catch {
      if (request === latestRequest.current) {
        setError('Could not load accounts.')
      }
    } finally {
      if (request === latestRequest.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    // Searching is a filtered scan of the accounts table, so it runs on a
    // short delay rather than on every keystroke.
    const timer = setTimeout(() => load(query), 250)
    return () => clearTimeout(timer)
  }, [query, load])

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every wallet account: its email, the DID that controls it, and where
            its storage space lives.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email, DID or space"
          aria-label="Search accounts"
          className="w-72 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Controlling DID</th>
              <th scope="col" className="px-4 py-3 font-medium">Space</th>
              <th scope="col" className="px-4 py-3 font-medium">Registered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts.map((account) => (
              <tr key={account.email} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/account?email=${encodeURIComponent(account.email)}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {account.email}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Did value={account.did} truncate />
                </td>
                <td className="px-4 py-3 text-xs break-all text-gray-500">
                  {account.spaceURL ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-500">
                  {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {!loading && accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {/* A filtered page can be empty while later pages still
                      match, so an empty page is only "no matches" when there
                      is nothing left to search. */}
                  {!query
                    ? 'No accounts yet.'
                    : cursor
                      ? 'Nothing on this page matches — keep looking.'
                      : 'No accounts match that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {cursor && (
          <button
            type="button"
            onClick={() => load(query, cursor)}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Load more
          </button>
        )}
        {loading && <span className="text-sm text-gray-500">Loading…</span>}
        {/* A filtered page can come back empty while more pages remain, so an
            empty result with a cursor is not the end of the list. */}
        {!loading && cursor && query && (
          <span className="text-xs text-gray-400">
            More accounts remain to be searched.
          </span>
        )}
      </div>
    </Layout>
  )
}
