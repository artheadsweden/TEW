import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'
import { useAuth } from './useAuth.js'
import AdminPage from './pages/AdminPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import DownloadsPage from './pages/DownloadsPage.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'
import LandingPage from './pages/LandingPage.jsx'
import ListenPage from './pages/ListenPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import InviteSignupPage from './pages/InviteSignupPage.jsx'
import ReadPage from './pages/ReadPage.jsx'
import HelpOverviewPage from './pages/HelpOverviewPage.jsx'
import HelpFeaturesPage from './pages/HelpFeaturesPage.jsx'

function RequireAuth({ children }) {
  const { authenticated, loading } = useAuth()
  if (loading) return <div className="container"><div className="card">Loading…</div></div>
  if (!authenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/invite" element={<InviteSignupPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/app"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/downloads"
            element={
              <RequireAuth>
                <DownloadsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/listen"
            element={
              <RequireAuth>
                <ListenPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/read"
            element={
              <RequireAuth>
                <ReadPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/feedback"
            element={
              <RequireAuth>
                <FeedbackPage />
              </RequireAuth>
            }
          />

          <Route
            path="/app/help"
            element={
              <RequireAuth>
                <HelpOverviewPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/help/features"
            element={
              <RequireAuth>
                <HelpFeaturesPage />
              </RequireAuth>
            }
          />

          <Route
            path="/admin"
            element={
              <RequireAuth>
                <AdminPage />
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

