import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav.jsx'
import { useAuth } from '../useAuth.js'
import { apiFetch } from '../api.js'

const PINNED_PROMPTS = [
  'Where did you feel confusion, and what exactly was unclear?',
  'Any point you felt the pacing drag or rush? (Where/why?)',
  'Which character felt most vivid, and which felt least grounded?',
  'Any moment that broke plausibility or continuity for you?',
  'What did you want *more of* in the next chapters?',
]

export default function DashboardPage() {
  const { user } = useAuth()

  const [manifest, setManifest] = useState({ chapters: [] })
  const [listeningProgress, setListeningProgress] = useState([])
  const [readingProgress, setReadingProgress] = useState({ cfi: null, chapterTitle: null, updatedAt: null })
  const [syncedAvailable, setSyncedAvailable] = useState(false)
  const [contrib, setContrib] = useState({ chaptersStarted: 0, notesCreated: 0, feedbackSubmitted: 0, lastActivityAt: null })
  const [buildInfo, setBuildInfo] = useState({ draftVersion: 'v0', updatedAt: null, whatChanged: [] })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [m, lp, rp, n, en, fb, bi] = await Promise.all([
          apiFetch('/api/audio/manifest', { method: 'GET' }),
          apiFetch('/api/progress', { method: 'GET' }),
          apiFetch('/api/epub/progress', { method: 'GET' }),
          apiFetch('/api/notes', { method: 'GET' }),
          apiFetch('/api/epub/notes', { method: 'GET' }),
          apiFetch('/api/feedback/mine', { method: 'GET' }),
          apiFetch('/api/build-info', { method: 'GET' }),
        ])
        if (cancelled) return
        setManifest(m)
        setListeningProgress(lp.items || [])
        setReadingProgress(rp || { cfi: null })
        setBuildInfo(bi || { draftVersion: 'v0', updatedAt: null, whatChanged: [] })

        const listenItems = lp.items || []
        const notes = (n?.items || [])
        const epubNotes = (en?.items || [])

        const chaptersStarted = listenItems.filter((x) => x?.chapterId).length
        const notesCreated = notes.length + epubNotes.length
        const feedbackSubmitted = Number(fb?.count) || 0

        function maxIso(a, b) {
          if (!a) return b
          if (!b) return a
          return String(a) >= String(b) ? a : b
        }

        let last = null
        for (const it of listenItems) last = maxIso(last, it?.updatedAt)
        last = maxIso(last, rp?.updatedAt)
        for (const it of notes) last = maxIso(last, it?.updatedAt || it?.createdAt)
        for (const it of epubNotes) last = maxIso(last, it?.updatedAt || it?.createdAt)
        last = maxIso(last, fb?.latestCreatedAt)

        setContrib({ chaptersStarted, notesCreated, feedbackSubmitted, lastActivityAt: last })

        try {
          await apiFetch('/api/audio/synced-text/chapter00', { method: 'GET' })
          if (!cancelled) setSyncedAvailable(true)
        } catch {
          if (!cancelled) setSyncedAvailable(false)
        }
      } catch {
        // keep page usable even if these fail
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const chapters = manifest.chapters || []

  const lastListening = useMemo(() => {
    const latest = (listeningProgress || [])
      .filter((x) => x?.chapterId && x?.updatedAt)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    if (!latest) return null
    const ch = chapters.find((c) => c.id === latest.chapterId)
    return {
      chapterId: latest.chapterId,
      title: ch?.title || latest.chapterId,
      seconds: Number(latest.positionSeconds) || 0,
      updatedAt: latest.updatedAt,
    }
  }, [listeningProgress, chapters])

  const lastReading = useMemo(() => {
    if (!readingProgress?.updatedAt) return null
    return {
      title: readingProgress.chapterTitle || 'Read',
      updatedAt: readingProgress.updatedAt,
      hasCfi: Boolean(readingProgress.cfi),
    }
  }, [readingProgress])

  const continueMode = useMemo(() => {
    if (lastListening && lastReading) {
      return String(lastListening.updatedAt) >= String(lastReading.updatedAt) ? 'listen' : 'read'
    }
    if (lastListening) return 'listen'
    if (lastReading?.hasCfi) return 'read'
    return 'listen'
  }, [lastListening, lastReading])

  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
  }

  function formatDate(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString()
    } catch {
      return '—'
    }
  }

  return (
    <>
      <TopNav />
      <div className="container page">
        <div className="grid12">
          <div className="colSpan7">
            <div className="card cardRaised">
              <div className="cardHeader">
                <div className="eyebrow">Night Desk Dossier</div>
                <h1 className="pageTitle">The Enemy Within</h1>
                <div className="titleRule" />
              </div>

              <div className="tileMeta" style={{ marginTop: 10 }}>
                <span className="chip chipAccent">Invite-only beta</span>
                <span className="chip">Private reading room</span>
                <span className="chip">Notes + bookmarks</span>
              </div>

              <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
                Welcome{user?.name ? `, ${user.name}` : ''}. Choose where you want to pick up the thread.
              </p>

              <div className="heroActions">
                <Link className="btn btnPrimary" to="/app/listen">Listen</Link>
                <Link className="btn btnSecondary" to="/app/read">Read</Link>
                <Link className="btn btnSecondary" to="/app/downloads">Downloads</Link>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Continue</h2>
                <span className={`stamp ${continueMode === 'listen' ? '' : ''}`}>{continueMode === 'listen' ? 'LISTEN' : 'READ'}</span>
              </div>
              <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
                <div className="card cardInset" style={{ padding: 12 }}>
                  <div className="tileHeader">
                    <div className="tileMeta">
                      <span className="chip">Last listened</span>
                    </div>
                    <div style={{ fontWeight: 650 }}>
                      {lastListening ? lastListening.title : '—'}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {lastListening ? `Resume at ${formatClock(lastListening.seconds)}` : 'No listening progress yet.'}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Link className="btn btnPrimary" to="/app/listen">Continue listening</Link>
                  </div>
                </div>

                <div className="card cardInset" style={{ padding: 12 }}>
                  <div className="tileHeader">
                    <div className="tileMeta">
                      <span className="chip">Last read</span>
                    </div>
                    <div style={{ fontWeight: 650 }}>
                      {lastReading?.hasCfi ? lastReading.title : '—'}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {lastReading?.hasCfi ? 'Resume where you left off.' : 'No reading progress yet.'}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Link className="btn btnSecondary" to="/app/read">Continue reading</Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="card cardInset" style={{ marginTop: 16, padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="chip chipAccent">Draft: {buildInfo?.draftVersion || 'v0'}</span>
                <span className="chip">Updated: {buildInfo?.updatedAt || '—'}</span>
                <span className="chip">Chapters available: {(manifest.chapters || []).length}</span>
                <span className={`chip ${syncedAvailable ? 'chipAccent' : ''}`}>Synced text: {syncedAvailable ? 'yes' : 'no'}</span>
                <span className="chip">Route: /app</span>
              </div>
            </div>

            {(buildInfo?.whatChanged || []).length ? (
              <div className="card cardInset" style={{ marginTop: 12, padding: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="chip">What changed</span>
                  <span className="muted" style={{ fontSize: 13 }}>A few bullets to help you focus re-reads.</span>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {(buildInfo.whatChanged || []).slice(0, 6).map((x) => (
                    <div key={x} className="muted" style={{ fontSize: 13 }}>• {x}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card cardInset" style={{ marginTop: 12, padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="chip chipAccent">You’re helping</span>
                <span className="chip">Chapters started: {contrib.chaptersStarted}</span>
                <span className="chip">Notes: {contrib.notesCreated}</span>
                <span className="chip">Feedback: {contrib.feedbackSubmitted}</span>
                <span className="chip">Last activity: {formatDate(contrib.lastActivityAt)}</span>
              </div>
            </div>

            <div className="sectionGrid" style={{ marginTop: 16 }}>
              <div className="card">
                <h2 style={{ marginTop: 0 }}>About the book</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  When a battered cardboard box finally gives up in a London flat, it spills out a private archive: tapes, leaflets, photographs, and the paper trail of a life spent in the orbit of protest.
                </p>
                <p className="muted" style={{ marginTop: 0 }}>
                  The Enemy Within follows a man looking back across the long shadow of Thatcher’s Britain — from coalfield anger and street organising to the quiet machinery that keeps movements alive: the phone trees, the coach grids, the meetings, the compromises, and the hard choices.
                </p>
                <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                  It’s a story about memory and evidence, music and infrastructure, and what it means to insist on a different version of events when the official story keeps changing.
                </p>
              </div>

              <div className="card">
                <h2 style={{ marginTop: 0 }}>About the author</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Joakim Wassberg writes historically grounded fiction with a bias towards lived detail: the small routines, the local language, the awkward jokes, the practical problems, the private compromises.
                </p>
                <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                  Alongside fiction, he builds tools and workflows for long-form creative projects, and he is drawn to the overlap between story, memory, and technology: how we record what happened, how we retell it, and how those retellings shape what comes next.
                </p>
              </div>
            </div>
          </div>

          <div className="colSpan5">
            <div className="stack">
              <div className="card cardInset">
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Field notes</h2>
                <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                  Leave feedback, capture lines, and track details as you go.
                </p>
                <div className="row">
                  <Link className="btn btnSecondary" to="/app/feedback">Feedback</Link>
                </div>
              </div>

              <div className="card cardInset">
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Pinned questions</h2>
                <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                  Answer any of these (short is fine). The goal is actionable edits.
                </p>
                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                  {PINNED_PROMPTS.map((q) => (
                    <div key={q} className="muted" style={{ fontSize: 13 }}>
                      • {q}
                    </div>
                  ))}
                </div>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Link
                    className="btn btnPrimary"
                    to="/app/feedback"
                    state={{ prefill: 'pinned-prompts', scope: 'general' }}
                  >
                    Start feedback
                  </Link>
                  <Link className="btn btnSecondary" to="/app/feedback">Open feedback</Link>
                </div>
              </div>

              <div className="card">
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Downloads</h2>
                <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                  Grab the latest EPUB/PDF when available.
                </p>
                <div className="row">
                  <Link className="btn btnSecondary" to="/app/downloads">Open downloads</Link>
                </div>
              </div>

              <div className="card cardInset">
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Pinned excerpt</h2>
                <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                  A short quoted moment can live here (manual pin).
                </p>
                <div className="stamp">DRAFT</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
