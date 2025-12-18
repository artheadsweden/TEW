import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from './api.js'
import { AuthContext } from './authContext.js'

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [user, setUser] = useState(null)

  async function refresh() {
    setLoading(true)
    try {
      const data = await apiFetch('/api/auth/me', { method: 'GET' })
      setAuthenticated(Boolean(data.authenticated))
      setUser(data.user || null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const value = useMemo(
    () => ({
      loading,
      authenticated,
      user,
      refresh,
      async login(email, password) {
        await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        await refresh()
      },
      async signup(name, email, password, inviteCode) {
        await apiFetch('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, password, inviteCode }),
        })
        await refresh()
      },
      async logout() {
        await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
        await refresh()
      },
    }),
    [loading, authenticated, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
