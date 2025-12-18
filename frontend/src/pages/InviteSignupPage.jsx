import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopNav from '../components/TopNav.jsx'
import { useAuth } from '../useAuth.js'

export default function InviteSignupPage() {
  const { signup } = useAuth()
  const nav = useNavigate()
  const [inviteCode, setInviteCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signup(name, email, password, inviteCode)
      nav('/app/help')
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
        <div className="card" style={{ maxWidth: 620 }}>
          <h1 style={{ marginTop: 0 }}>Create account</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            You need an invite code. Each code can only be used once.
          </p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Invite code</label>
              <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            </div>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
            </div>
            <div className="field">
              <label>Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" />
            </div>
            {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}
            <button disabled={busy} type="submit">{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        </div>
      </div>
    </>
  )
}
