import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clearSession, getSession } from '../lib/session'

interface Props {
  children: ReactNode
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const session = getSession()

  function signOut() {
    clearSession()
    navigate('/login', { replace: true })
  }

  const tab = (to: string, label: string) => (
    <Link
      to={to}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        pathname === to
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="font-semibold text-gray-900">LCW Admin</span>
          <nav className="flex items-center gap-1">
            {tab('/accounts', 'Accounts')}
            {tab('/activity', 'Activity')}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-500" title={session?.did}>
              {session?.email}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
