import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import TopNav from '../components/TopNav.jsx'
import { useAuth } from '../useAuth.js'

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      nav('/app')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopNav />
      <div className="container">
        <div className="card" style={{ maxWidth: 520 }}>
          <h1 style={{ marginTop: 0 }}>Log in</h1>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
            </div>
            <div className="field">
              <label>Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
            </div>
            {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}
            <button disabled={busy} type="submit">{busy ? 'Logging in…' : 'Log in'}</button>
          </form>
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
            Have an invite? <Link to="/invite">Create an account</Link>
          </p>
        </div>
      </div>
    </>
  )
}
