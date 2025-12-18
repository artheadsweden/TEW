import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import TopNav from '../components/TopNav.jsx'
import { apiFetch } from '../api.js'
import HelpTip from '../components/HelpTip.jsx'

const PINNED_PROMPTS = [
  'Where did you feel confusion, and what exactly was unclear?',
  'Any point you felt the pacing drag or rush? (Where/why?)',
  'Which character felt most vivid, and which felt least grounded?',
  'Any moment that broke plausibility or continuity for you?',
  'What did you want *more of* in the next chapters?',
]

export default function FeedbackPage() {
  const location = useLocation()
  const prefillAppliedRef = useRef(false)

  const [buildInfo, setBuildInfo] = useState({ draftVersion: 'v0', updatedAt: null, whatChanged: [] })

  const [manifest, setManifest] = useState({ bookTitle: 'The Enemy Within', chapters: [] })
  const [notes, setNotes] = useState([])
  const [epubNotes, setEpubNotes] = useState([])
  const [scope, setScope] = useState(() => {
    const st = location?.state
    if (!st || typeof st !== 'object') return 'chapter'
    if (String(st.prefill || '') !== 'pinned-prompts') return 'chapter'
    return String(st.scope || '') === 'general' ? 'general' : 'chapter'
  })
  const [chapterId, setChapterId] = useState('chapter00')
  const [text, setText] = useState('')
  const [ratings, setRatings] = useState({ clarity: '', pacing: '', characters: '' })
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        setError(null)
        const [m, n] = await Promise.all([
          apiFetch('/api/audio/manifest', { method: 'GET' }),
          apiFetch('/api/notes', { method: 'GET' }),
        ])
        const en = await apiFetch('/api/epub/notes', { method: 'GET' })
        try {
          const bi = await apiFetch('/api/build-info', { method: 'GET' })
          setBuildInfo(bi || { draftVersion: 'v0', updatedAt: null, whatChanged: [] })
        } catch {
          // ignore
        }
        setManifest(m)
        setNotes(n.items || [])
        setEpubNotes(en.items || [])
        const first = (m.chapters || [])[0]
        if (first) setChapterId(first.id)
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [])

  useEffect(() => {
    if (prefillAppliedRef.current) return
    const st = location?.state
    if (!st || typeof st !== 'object') return
    if (String(st.prefill || '') !== 'pinned-prompts') return

    prefillAppliedRef.current = true
    const t = setTimeout(() => {
      setText((prev) => {
        if (String(prev || '').trim()) return prev
        const tpl = [
          'Pinned questions (answer any):',
          ...PINNED_PROMPTS.map((q) => `- ${q}`),
          '',
          'What worked:',
          '',
          'What confused:',
          '',
          'Suggested change:',
          '',
        ].join('\n')
        return tpl
      })
    }, 0)
    return () => clearTimeout(t)
  }, [location])

  const chapters = manifest.chapters || []
  const notesForScope = useMemo(() => {
    if (scope === 'general') return notes
    return notes.filter((n) => n.chapterId === chapterId)
  }, [notes, scope, chapterId])

  const chapterTitle = useMemo(() => {
    const c = chapters.find((x) => x.id === chapterId)
    return c?.title || ''
  }, [chapters, chapterId])

  const epubNotesForScope = useMemo(() => {
    if (scope === 'general') return epubNotes
    const want = (chapterTitle || '').trim().toLowerCase()
    if (!want) return epubNotes
    return epubNotes.filter((n) => {
      const t = (n.chapterTitle || '').trim().toLowerCase()
      if (!t) return false
      return t === want || t.includes(want) || want.includes(t)
    })
  }, [epubNotes, scope, chapterTitle])

  function appendNote(n) {
    const meta = [n?.type, n?.severity, n?.spoiler ? 'spoiler' : null].filter(Boolean).join(', ')
    setText((prev) => {
      const prefix = prev.trim() ? prev.trim() + '\n\n' : ''
      return `${prefix}[Listen: ${n.chapterId} @ ${Math.floor(n.positionSeconds)}s]${meta ? ` (${meta})` : ''}\n${n.text}`
    })
  }

  function appendEpubNote(n) {
    const meta = [n?.type, n?.severity, n?.spoiler ? 'spoiler' : null].filter(Boolean).join(', ')
    setText((prev) => {
      const prefix = prev.trim() ? prev.trim() + '\n\n' : ''
      const where = n.chapterTitle ? `Read: ${n.chapterTitle}` : 'Read'
      const excerpt = (n.excerpt || '').trim()
      const exBlock = excerpt ? `Excerpt: ${excerpt}\n` : ''
      return `${prefix}[${where}]${meta ? ` (${meta})` : ''}\n${exBlock}${n.text}`
    })
  }

  function insertTemplate() {
    setText((prev) => {
      const base = (prev || '').trim()
      const tpl = [
        'What worked:',
        '',
        'What confused:',
        '',
        'Suggested change:',
        '',
        'Questions:',
        '',
      ].join('\n')
      if (!base) return tpl
      return `${base}\n\n${tpl}`
    })
  }

  function ratingsPrefix() {
    const parts = []
    if (ratings.clarity) parts.push(`clarity ${ratings.clarity}/5`)
    if (ratings.pacing) parts.push(`pacing ${ratings.pacing}/5`)
    if (ratings.characters) parts.push(`characters ${ratings.characters}/5`)
    if (!parts.length) return ''
    return `Ratings: ${parts.join(', ')}`
  }

  async function submit(e) {
    e.preventDefault()
    setOk(false)
    setError(null)
    try {
      const prefix = ratingsPrefix()
      const finalText = (prefix ? `${prefix}\n\n` : '') + String(text || '').trim()
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          chapterId: scope === 'chapter' ? chapterId : null,
          text: finalText,
          draftVersion: buildInfo?.draftVersion || null,
        }),
      })
      setOk(true)
      setText('')
      setRatings({ clarity: '', pacing: '', characters: '' })
    } catch (e2) {
      setError(e2.message)
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
                <div className="eyebrow">Field Report</div>
                <h1 className="pageTitle">Feedback</h1>
                <div className="titleRule" />
              </div>

              <div className="tileMeta" style={{ marginTop: 10 }}>
                <span className={`chip ${scope === 'chapter' ? 'chipAccent' : ''}`}>Chapter</span>
                <span className={`chip ${scope === 'general' ? 'chipAccent' : ''}`}>General</span>
                <span className="chip">Draft: {buildInfo?.draftVersion || 'v0'}</span>
                <span className="chip">Updated: {buildInfo?.updatedAt || '—'}</span>
              </div>

              <form onSubmit={submit} style={{ marginTop: 12 }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="field" style={{ minWidth: 240, flex: '0 0 240px' }}>
                    <label>
                      Scope
                      <HelpTip text="Use Chapter when feedback is tied to a specific part; use General for overall impressions." />
                    </label>
                    <select value={scope} onChange={(e) => setScope(e.target.value)}>
                      <option value="chapter">A particular chapter</option>
                      <option value="general">General / multiple chapters</option>
                    </select>
                  </div>

                  <div className="field" style={{ minWidth: 260, flex: '1 1 260px', opacity: scope === 'chapter' ? 1 : 0.55 }}>
                    <label>Chapter</label>
                    <select value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={scope !== 'chapter'}>
                      {chapters.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>Your feedback</label>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write feedback…" />
                </div>

                <div className="row" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
                  <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                    <label>Clarity (optional)</label>
                    <select value={ratings.clarity} onChange={(e) => setRatings((r) => ({ ...r, clarity: e.target.value }))}>
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                    <label>Pacing (optional)</label>
                    <select value={ratings.pacing} onChange={(e) => setRatings((r) => ({ ...r, pacing: e.target.value }))}>
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                    <label>Characters (optional)</label>
                    <select value={ratings.characters} onChange={(e) => setRatings((r) => ({ ...r, characters: e.target.value }))}>
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                    </select>
                  </div>
                </div>

                {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}
                {ok ? <div className="ok" style={{ marginBottom: 10 }}>Submitted.</div> : null}

                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Tip: click a note in the rail to insert it.
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <button type="button" className="btn btnSecondary" onClick={insertTemplate}>Insert template</button>
                    <HelpTip text="Adds headings like What worked / What confused so it’s easier to be specific." />
                    <button type="submit" disabled={!text.trim()}>Submit feedback</button>
                  </div>
                </div>
              </form>
            </div>
          </div>

          <div className="colSpan5">
            <div className="sideRail">
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0 }}>Notes</h2>
                  <span className="chip">{notesForScope.length + epubNotesForScope.length}</span>
                </div>
                <p className="muted" style={{ marginTop: 10, marginBottom: 12 }}>
                  Insert listening/reading notes into your feedback.
                </p>

                <div className="card cardInset" style={{ padding: 12 }}>
                  <h3 style={{ marginTop: 0 }}>Listening</h3>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {notesForScope.length === 0 ? (
                      <div className="muted">
                        No listening notes for this scope yet. Example: “Pacing slows here” · “Fact check: …”
                      </div>
                    ) : null}
                    {notesForScope.map((n) => (
                      <button key={n.id} onClick={() => appendNote(n)} style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 12 }} className="muted">{n.chapterId} @ {Math.floor(n.positionSeconds)}s</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card cardInset" style={{ padding: 12, marginTop: 12 }}>
                  <h3 style={{ marginTop: 0 }}>Reading</h3>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {epubNotesForScope.length === 0 ? (
                      <div className="muted">
                        No reading notes for this scope yet. Tip: select text in Read to capture an excerpt.
                      </div>
                    ) : null}
                    {epubNotesForScope.map((n) => (
                      <button key={n.id} onClick={() => appendEpubNote(n)} style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 12 }} className="muted">{n.chapterTitle || 'Read'}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
