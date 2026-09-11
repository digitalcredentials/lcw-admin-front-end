import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AccountsPage from './pages/AccountsPage'
import AccountPage from './pages/AccountPage'
import AuditPage from './pages/AuditPage'
import RequireAuth from './components/RequireAuth'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/accounts"
          element={
            <RequireAuth>
              <AccountsPage />
            </RequireAuth>
          }
        />
        {/* The email is the account id, and it contains an '@' - so it goes in
            a query parameter rather than a path segment, where react-router
            would have to be taught not to split it. */}
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="/activity"
          element={
            <RequireAuth>
              <AuditPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/accounts" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
