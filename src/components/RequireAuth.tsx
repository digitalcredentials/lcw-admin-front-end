import { Navigate } from 'react-router-dom'
import { isSignedIn } from '../lib/session'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

// Client-side only, and it hides nothing that matters: the API verifies the
// signature on every request, so this is a convenience for the admin rather
// than a control on what they can do.
export default function RequireAuth({ children }: Props) {
  if (!isSignedIn()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
