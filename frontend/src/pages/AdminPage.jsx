import { useEffect, useState } from 'react'
import TopNav from '../components/TopNav.jsx'
import { useAuth } from '../useAuth.js'
import { apiFetch } from '../api.js'

function computePromptCoverage(text) {
  const raw = String(text || '')
  const t = raw.toLowerCase()

  const hasWorked = /(^|\n)what worked:\s*/i.test(raw)
  const hasConfused = /(^|\n)what confused:\s*/i.test(raw)
  const hasSuggested = /(^|\n)suggested change:\s*/i.test(raw)
  const hasQuestions = /(^|\n)questions:\s*/i.test(raw)
  const hasRatings = /(^|\n)ratings:\s*/i.test(raw)
  const hasPinned = t.includes('pinned questions')

  const sections = [
    { key: 'worked', label: 'worked', ok: hasWorked },
    { key: 'confused', label: 'confused', ok: hasConfused },
    { key: 'suggested', label: 'change', ok: hasSuggested },
    { key: 'questions', label: 'questions', ok: hasQuestions },
  ]
  const covered = sections.filter((s) => s.ok).length
  return {
    sections,
    covered,
    total: sections.length,
    hasRatings,
    hasPinned,
  }
}

function extractDraftVersion(f) {
  if (f?.draftVersion) return String(f.draftVersion)
  const t = String(f?.text || '')
  const m = t.match(/(^|\n)draft:\s*([^\n]+)/i)
  return m ? String(m[2]).trim() : ''
}

export default function AdminPage() {
  const { user } = useAuth()
  const [inviteCode, setInviteCode] = useState('')
  const [invites, setInvites] = useState([])
  const [feedback, setFeedback] = useState([])
  const [progress, setProgress] = useState([])
  const [error, setError] = useState(null)

  const [fbStatus, setFbStatus] = useState('all')
  const [fbScope, setFbScope] = useState('all')
  const [fbChapter, setFbChapter] = useState('all')
  const [fbSearch, setFbSearch] = useState('')

  async function refreshAll() {
    setError(null)
    try {
      const [i, f, p] = await Promise.all([
        apiFetch('/api/admin/invites', { method: 'GET' }).catch((e) => {
          throw new Error(`Invites: ${e.message}`)
        }),
        apiFetch('/api/admin/feedback', { method: 'GET' }).catch((e) => {
          throw new Error(`Feedback: ${e.message}`)
        }),
        apiFetch('/api/admin/progress', { method: 'GET' }).catch((e) => {
          throw new Error(`Progress: ${e.message}`)
        }),
      ])
      setInvites(i.items || [])
      setFeedback(f.items || [])
      setProgress(p.items || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    if (!user?.isAdmin) return
    const t = setTimeout(() => {
      refreshAll()
    }, 0)
    return () => clearTimeout(t)
  }, [user?.isAdmin])

  async function addInvite(e) {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch('/api/admin/invites', { method: 'POST', body: JSON.stringify({ code: inviteCode }) })
      setInviteCode('')
      await refreshAll()
    } catch (e2) {
      setError(e2.message)
    }
  }

  return (
    <>
      <TopNav />
      <div className="container page">
        <div className="card cardRaised">
          <div className="cardHeader">
            <div className="eyebrow">Control Room</div>
            <h1 className="pageTitle">Admin</h1>
            <div className="titleRule" />
          </div>
          {!user?.isAdmin ? <div className="error">Forbidden.</div> : null}
          {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}
        </div>

        {user?.isAdmin ? (
          <>
            <div className="card" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Invite codes</h2>
                <span className="chip">{invites.length}</span>
              </div>
              <form onSubmit={addInvite} className="row" style={{ alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0, minWidth: 280 }}>
                  <label>New code</label>
                  <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
                </div>
                <button type="submit" disabled={!inviteCode.trim()}>Add code</button>
                <button type="button" onClick={refreshAll}>Refresh</button>
              </form>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {invites.map((c) => (
                  <div key={c.code} className="card cardInset" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 600 }}>{c.code}</div>
                      <div className="muted">{c.usedAt ? `Used by ${c.usedByEmail || ''}` : 'Unused'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Feedback</h2>
                <span className="chip">{feedback.length}</span>
              </div>

              <div className="row" style={{ marginTop: 10, gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                  <label>Status</label>
                  <select value={fbStatus} onChange={(e) => setFbStatus(e.target.value)}>
                    <option value="all">All</option>
                    <option value="new">new</option>
                    <option value="triaged">triaged</option>
                    <option value="fixed">fixed</option>
                  </select>
                </div>

                <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                  <label>Scope</label>
                  <select value={fbScope} onChange={(e) => setFbScope(e.target.value)}>
                    <option value="all">All</option>
                    <option value="chapter">chapter</option>
                    <option value="general">general</option>
                  </select>
                </div>

                <div className="field" style={{ marginBottom: 0, minWidth: 220, flex: '0 0 220px' }}>
                  <label>Chapter</label>
                  <select value={fbChapter} onChange={(e) => setFbChapter(e.target.value)}>
                    <option value="all">All</option>
                    {Array.from(new Set((feedback || []).map((f) => f.chapterId).filter(Boolean))).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="field" style={{ marginBottom: 0, minWidth: 240, flex: '1 1 240px' }}>
                  <label>Search</label>
                  <input value={fbSearch} onChange={(e) => setFbSearch(e.target.value)} placeholder="Find text…" />
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {feedback.length === 0 ? <div className="muted">No feedback yet.</div> : null}
                {feedback
                  .filter((f) => {
                    if (fbStatus !== 'all' && String(f.status || 'new') !== fbStatus) return false
                    if (fbScope !== 'all' && String(f.scope || '') !== fbScope) return false
                    if (fbChapter !== 'all' && String(f.chapterId || '') !== fbChapter) return false
                    const q = (fbSearch || '').trim().toLowerCase()
                    if (q) {
                      const hay = `${f.text || ''} ${f.chapterId || ''} ${f.scope || ''}`.toLowerCase()
                      if (!hay.includes(q)) return false
                    }
                    return true
                  })
                  .map((f) => (
                    <div key={f.id} className="card cardInset" style={{ padding: 10 }}>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {f.createdAt} — user {f.userId} — {f.scope}{f.chapterId ? ` (${f.chapterId})` : ''}
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <span className={`chip ${String(f.status || 'new') === 'new' ? 'chipAccent' : ''}`}>{String(f.status || 'new')}</span>
                          <select
                            value={String(f.status || 'new')}
                            onChange={async (e) => {
                              const next = e.target.value
                              try {
                                await apiFetch(`/api/admin/feedback/${f.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) })
                                setFeedback((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: next } : x)))
                              } catch (e2) {
                                setError(e2.message)
                              }
                            }}
                          >
                            <option value="new">new</option>
                            <option value="triaged">triaged</option>
                            <option value="fixed">fixed</option>
                          </select>
                        </div>
                      </div>

                      {(() => {
                        const cov = computePromptCoverage(f.text)
                        const dv = extractDraftVersion(f)
                        return (
                          <div className="tileMeta" style={{ marginTop: 8 }}>
                            {dv ? <span className="chip">Draft: {dv}</span> : null}
                            <span className="chip">Coverage: {cov.covered}/{cov.total}</span>
                            {cov.hasPinned ? <span className="chip">pinned</span> : null}
                            {cov.hasRatings ? <span className="chip">ratings</span> : null}
                            {cov.sections.filter((s) => s.ok).map((s) => (
                              <span key={s.key} className="chip chipAccent">{s.label}</span>
                            ))}
                          </div>
                        )
                      })()}

                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{f.text}</div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Listening progress</h2>
                <span className="chip">{progress.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {progress.map((p) => (
                  <div key={p.userId} className="card cardInset" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.name} <span className="muted">({p.email})</span></div>
                        <div className="muted" style={{ fontSize: 12 }}>Chapters started: {p.chaptersStarted}</div>
                      </div>
                      <div className="muted" style={{ textAlign: 'right' }}>
                        {p.latest ? (
                          <>
                            <div>{p.latest.chapterId}</div>
                            <div style={{ fontSize: 12 }}>{Math.floor(p.latest.positionSeconds)}s</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12 }}>No activity</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
