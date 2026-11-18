import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import Did from '../components/Did'
import { listAllAccounts, type Account } from '../lib/api'
import {
  COLUMNS,
  EMPTY_QUERY,
  accountsCsv,
  filterAccounts,
  isFiltered,
  type ColumnKey,
  type TableQuery
} from '../lib/accountTable'
import { download } from '../lib/download'

// Every wallet account in one table: loaded in full, then filtered by column,
// searched across all columns, and exported as a CSV of exactly the rows on
// screen.
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [loadedSoFar, setLoadedSoFar] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState<TableQuery>(EMPTY_QUERY)

  // A reload started while another is still paging must win, rather than the
  // slower one landing last with an older list.
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const run = ++latestLoad.current
    setLoading(true)
    setError('')
    setLoadedSoFar(0)
    try {
      const all = await listAllAccounts((count) => {
        if (run === latestLoad.current) setLoadedSoFar(count)
      })
      if (run === latestLoad.current) setAccounts(all)
    } catch {
      if (run === latestLoad.current) setError('Could not load the accounts.')
    } finally {
      if (run === latestLoad.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => (accounts ? filterAccounts(accounts, query) : []), [accounts, query])

  const setFilter = (key: ColumnKey, value: string) =>
    setQuery((current) => ({ ...current, filters: { ...current.filters, [key]: value } }))

  function exportCsv() {
    download(`lcw-accounts-${new Date().toISOString().slice(0, 10)}.csv`, accountsCsv(shown), 'text/csv')
  }

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every wallet account: its email, the DID it registered, when, and
            whether it agreed to be contacted with news and updates. Filter by
            column, search them all, and export what is shown.
          </p>
        </div>
        <input
          type="search"
          value={query.search}
          onChange={(e) => setQuery((current) => ({ ...current, search: e.target.value }))}
          placeholder="Search all columns"
          aria-label="Search accounts"
          className="w-72 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}{' '}
          <button type="button" onClick={load} className="font-medium underline">
            Retry
          </button>
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs tracking-wide text-gray-500">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="px-4 pt-3 pb-2 font-medium whitespace-nowrap uppercase">
                  {column.label}
                </th>
              ))}
            </tr>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="px-4 pb-3 font-normal">
                  {column.choices ? (
                    <select
                      value={query.filters[column.key] ?? ''}
                      onChange={(e) => setFilter(column.key, e.target.value)}
                      aria-label={`Filter ${column.label}`}
                      className="w-full min-w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="">All</option>
                      {column.choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="search"
                      value={query.filters[column.key] ?? ''}
                      onChange={(e) => setFilter(column.key, e.target.value)}
                      placeholder="Filter"
                      aria-label={`Filter ${column.label}`}
                      className="w-full min-w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((account) => (
              <tr key={account.email} className="hover:bg-gray-50">
                {COLUMNS.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">
                    {column.key === 'email' ? (
                      <Link
                        to={`/account?email=${encodeURIComponent(account.email)}`}
                        className="text-sm font-medium text-indigo-700 hover:underline"
                      >
                        {account.email}
                      </Link>
                    ) : column.key === 'did' ? (
                      <Did value={account.did} truncate />
                    ) : (
                      column.value(account) || '—'
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {accounts && shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-sm text-gray-500">
                  {accounts.length === 0 ? 'No accounts yet.' : 'No accounts match these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500" role="status">
          {loading
            ? `Loading accounts…${loadedSoFar > 0 ? ` ${loadedSoFar} so far` : ''}`
            : accounts
              ? `Showing ${shown.length} of ${accounts.length} accounts`
              : ''}
        </span>
        {isFiltered(query) && (
          <button
            type="button"
            onClick={() => setQuery(EMPTY_QUERY)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || shown.length === 0}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Reload
        </button>
      </div>
    </Layout>
  )
}
