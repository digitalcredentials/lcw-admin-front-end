import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { deriveKeyPair, whoami, ApiError } from '../lib/api'
import { setSession } from '../lib/session'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // The passphrase never leaves the browser: it derives a key, that key
      // signs a request, and the API verifies the signature against the DID
      // registered for it.
      const keyPair = await deriveKeyPair(passphrase)
      const identity = await whoami(keyPair)
      // The email is asked for so an admin can tell which identity they are
      // signing in as, but it is the signature that decides: if the derived
      // key is not a registered admin's, nothing here will work.
      setSession({
        did: identity.did,
        email: identity.email || email,
        exportedKeyPair: await keyPair.export({ secretKey: true, includeContext: true })
      })
      navigate('/accounts')
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      if (status === 401 || status === 403) {
        setError('That passphrase does not belong to a registered admin.')
      } else {
        // A refusal the browser could not read looks exactly like an API that
        // is not there, so say both rather than guess at one.
        setError(
          'Could not sign in: either that passphrase does not belong to a ' +
            'registered admin, or the admin API could not be reached.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">LCW Admin</h1>
          <p className="mt-2 text-sm text-gray-500">
            Administration of wallet accounts
          </p>
        </header>
        <div className="w-full rounded-2xl bg-white p-8 shadow-md">
          <h2 className="mb-1 text-2xl font-semibold text-gray-800">Sign in</h2>
          <p className="mb-6 text-sm text-gray-500">
            Admin accounts are separate from wallet accounts. A wallet
            passphrase will not work here.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="you@example.org"
              />
            </div>

            <div>
              <label htmlFor="passphrase" className="mb-1 block text-sm font-medium text-gray-700">
                Passphrase
              </label>
              <input
                id="passphrase"
                type="password"
                autoComplete="current-password"
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          Your signing key is kept for this browser tab only, and is discarded
          when the tab closes.
        </p>
      </div>
    </div>
  )
}
