import { Link, NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../useAuth.js'
import { apiFetch } from '../api.js'

export default function TopNav() {
  const { authenticated, user, logout } = useAuth()
  const location = useLocation()

  const [continueTarget, setContinueTarget] = useState(null)

  const showContinue = useMemo(() => {
    if (!authenticated) return false
    if (!location?.pathname) return false
    return location.pathname !== '/app'
  }, [authenticated, location?.pathname])

  useEffect(() => {
    if (!authenticated) return
    if (!showContinue) return

    let cancelled = false
    ;(async () => {
      try {
        const [lp, rp] = await Promise.all([
          apiFetch('/api/progress', { method: 'GET' }),
          apiFetch('/api/epub/progress', { method: 'GET' }),
        ])

        const listening = (lp?.items || [])
          .filter((x) => x?.updatedAt)
          .map((x) => ({ updatedAt: x.updatedAt }))
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]

        const reading = rp?.updatedAt ? { updatedAt: rp.updatedAt } : null

        let next = null
        if (listening && reading) {
          next = String(listening.updatedAt) >= String(reading.updatedAt)
            ? { href: '/app/listen', label: 'Continue listening' }
            : { href: '/app/read', label: 'Continue reading' }
        } else if (listening) {
          next = { href: '/app/listen', label: 'Continue listening' }
        } else if (reading) {
          next = { href: '/app/read', label: 'Continue reading' }
        }

        if (!cancelled) setContinueTarget(next)
      } catch {
        if (!cancelled) setContinueTarget(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authenticated, showContinue])

  return (
    <div className="topNav">
      <div className="container topNavInner">
        <div className="topNavLeft">
                <NavLink to="/" className="brandLink" aria-label="The Enemy Within">
            <img className="brandBadge" src="/tew-badge.png" alt="The Enemy Within" />
                </NavLink>
          {authenticated ? (
            <>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app" end>
                      Home
                    </NavLink>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app/downloads">
                      Downloads
                    </NavLink>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app/listen">
                      Listen
                    </NavLink>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app/read">
                      Read
                    </NavLink>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app/feedback">
                      Feedback
                    </NavLink>
                    <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/app/help">
                      Help
                    </NavLink>
                    {user?.isAdmin ? (
                      <NavLink className={({ isActive }) => `navLink${isActive ? ' navLinkActive' : ''}`} to="/admin">
                        Admin
                      </NavLink>
                    ) : null}
            </>
          ) : null}
        </div>

        <div className="topNavRight">
          {authenticated ? (
            <>
              {showContinue && continueTarget ? (
                <NavLink className="btn btnSecondary" to={continueTarget.href}>
                  {continueTarget.label}
                </NavLink>
              ) : null}
              <span className="muted" style={{ fontSize: 13 }}>
                {(() => {
                  const raw = String(user?.name || '').trim()
                  if (raw) return raw.split(/\s+/)[0]
                  const em = String(user?.email || '').trim()
                  return em ? em.split('@')[0] : ''
                })()}
              </span>
              <button onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/invite" className="navLink">Invite</Link>
              <Link to="/login" className="navLink">Log in</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
