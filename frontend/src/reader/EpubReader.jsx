import { useEffect, useMemo, useRef, useState } from 'react'
import ePub from 'epubjs'
import { apiFetch, apiUrl } from '../api.js'
import HelpTip from '../components/HelpTip.jsx'

export default function EpubReader() {
  const viewerRef = useRef(null)
  const bookRef = useRef(null)
  const renditionRef = useRef(null)
  const saveTimerRef = useRef(null)
  const readerSettingsTimerRef = useRef(null)
  const readerSettingsRef = useRef({ theme: 'paper', fontScale: 1.0, lineHeight: 1.65 })
  const tocByNormHrefRef = useRef(new Map())
  const boundHotkeyTargetsRef = useRef(new Set())

  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const [toc, setToc] = useState([])
  const [currentCfi, setCurrentCfi] = useState(null)
  const [currentChapterTitle, setCurrentChapterTitle] = useState(null)
  const [currentChapterHref, setCurrentChapterHref] = useState(null)

  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('')
  const [noteSeverity, setNoteSeverity] = useState('')
  const [noteSpoiler, setNoteSpoiler] = useState(false)
  const [pendingSelection, setPendingSelection] = useState(null)
  const [bookmarks, setBookmarks] = useState([])
  const [notes, setNotes] = useState([])
  const [notesCurrentOnly, setNotesCurrentOnly] = useState(true)

  const [selectedTocHref, setSelectedTocHref] = useState('')

  const [readerTheme, setReaderTheme] = useState('paper')
  const [readerFontScale, setReaderFontScale] = useState(1.0)
  const [readerLineHeight, setReaderLineHeight] = useState(1.65)

  useEffect(() => {
    readerSettingsRef.current = {
      theme: readerTheme,
      fontScale: readerFontScale,
      lineHeight: readerLineHeight,
    }
  }, [readerTheme, readerFontScale, readerLineHeight])

  function getToken(name) {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    } catch {
      return ''
    }
  }

  function hexToRgb(hex) {
    const s = String(hex || '').trim()
    const m = s.match(/^#?([0-9a-fA-F]{6})$/)
    if (!m) return null
    const n = parseInt(m[1], 16)
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
    }
  }

  function rgbToHex({ r, g, b }) {
    const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)))
    const to2 = (x) => clamp(x).toString(16).padStart(2, '0')
    return `#${to2(r)}${to2(g)}${to2(b)}`
  }

  function blendHex(a, b, t) {
    const A = hexToRgb(a)
    const B = hexToRgb(b)
    if (!A || !B) return null
    const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
    return rgbToHex({
      r: A.r * (1 - k) + B.r * k,
      g: A.g * (1 - k) + B.g * k,
      b: A.b * (1 - k) + B.b * k,
    })
  }

  function applyReaderStyles(rendition) {
    if (!rendition) return

    const s = readerSettingsRef.current || {}
    const theme = s.theme === 'night' ? 'night' : (s.theme === 'white' ? 'white' : 'paper')
    const fontScale = Number.isFinite(s.fontScale) ? s.fontScale : 1.0
    const lineHeight = Number.isFinite(s.lineHeight) ? s.lineHeight : 1.65

    const bg0 = getToken('--bg-0') || '#070A10'
    const text0 = getToken('--text-0') || 'rgba(255, 255, 255, 0.92)'
    const text1 = getToken('--text-1') || 'rgba(255, 255, 255, 0.74)'
    const accent2 = getToken('--accent2') || '#C7A15A'
    const fontReading = getToken('--font-reading')

    const paperBg = blendHex('#ffffff', accent2, 0.07) || '#ffffff'

    const bg = theme === 'night' ? bg0 : (theme === 'white' ? '#ffffff' : paperBg)
    const fg = theme === 'night' ? text0 : '#111111'
    const link = theme === 'night' ? (accent2 || text1) : '#111111'
    const fontPct = Math.round(fontScale * 100)
    const css = `
      html, body {
        background: ${bg} !important;
        color: ${fg} !important;
        line-height: ${lineHeight} !important;
        font-size: ${fontPct}% !important;
        ${fontReading ? `font-family: ${fontReading} !important;` : ''}
      }
      p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6 {
        color: inherit !important;
      }
      a { color: ${link} !important; }
    `.trim()

    let contentsList = []
    try {
      contentsList = rendition.getContents?.() || []
    } catch {
      contentsList = []
    }
    if (!Array.isArray(contentsList) || contentsList.length === 0) return

    for (const c of contentsList) {
      const doc = c?.document
      if (!doc) continue
      try {
        let styleEl = doc.getElementById('reader-comfort-style')
        if (!styleEl) {
          styleEl = doc.createElement('style')
          styleEl.id = 'reader-comfort-style'
          doc.head?.appendChild(styleEl)
        }
        styleEl.textContent = css
      } catch {
        // ignore
      }
    }
  }

  function scheduleSaveReaderSettings(next) {
    if (readerSettingsTimerRef.current) clearTimeout(readerSettingsTimerRef.current)
    readerSettingsTimerRef.current = setTimeout(() => {
      apiFetch('/api/me/reader-settings', {
        method: 'PUT',
        body: JSON.stringify(next),
      }).catch(() => {})
    }, 700)
  }

  function normalizeHref(href) {
    return (href || '').split('#')[0]
  }

  const tocOptions = useMemo(() => {
    const flat = []
    function walk(items, depth) {
      for (const it of items || []) {
        flat.push({ href: it.href, normHref: normalizeHref(it.href), label: `${'—'.repeat(depth)}${it.label || it.href}` })
        walk(it.subitems, depth + 1)
      }
    }
    walk(toc, 0)
    return flat
  }, [toc])

  const tocByNormHref = useMemo(() => {
    const map = new Map()
    for (const t of tocOptions) {
      if (t.normHref) map.set(t.normHref, t)
    }
    return map
  }, [tocOptions])

  useEffect(() => {
    tocByNormHrefRef.current = tocByNormHref
  }, [tocByNormHref])

  function raf() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()))
  }

  async function forceRenditionPaint() {
    // Helps on some browsers where display/next updates only show after a reload.
    await raf()
    await raf()
    try {
      renditionRef.current?.resize()
    } catch {
      // ignore
    }
    await raf()
  }

  async function safeDisplay(target) {
    const rendition = renditionRef.current
    if (!rendition) return
    try {
      await rendition.display(target)
      await forceRenditionPaint()
    } catch (e) {
      setError(e?.message || 'Navigation failed')
    }
  }

  function scheduleSave(cfi, chapterHref, chapterTitle) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      apiFetch('/api/epub/progress', {
        method: 'POST',
        body: JSON.stringify({ cfi, chapterHref, chapterTitle }),
      }).catch(() => {})
    }, 1200)
  }

  async function refreshEpubNotesAndBookmarks() {
    const [b, n] = await Promise.all([
      apiFetch('/api/epub/bookmarks', { method: 'GET' }),
      apiFetch('/api/epub/notes', { method: 'GET' }),
    ])
    setBookmarks(b.items || [])
    setNotes(n.items || [])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setError(null)

        // Load reader comfort settings (per-user).
        try {
          const s = await apiFetch('/api/me/reader-settings', { method: 'GET' })
          if (s?.theme) setReaderTheme(s.theme)
          if (Number.isFinite(Number(s?.fontScale))) setReaderFontScale(Number(s.fontScale))
          if (Number.isFinite(Number(s?.lineHeight))) setReaderLineHeight(Number(s.lineHeight))
        } catch {
          // ignore; defaults apply
        }

        // Load EPUB behind auth.
        const epubUrl = apiUrl('/api/book/epub')
        const resp = await fetch(epubUrl, { credentials: 'include' })
        if (!resp.ok) {
          let detail = ''
          const ct = (resp.headers.get('content-type') || '').toLowerCase()
          try {
            if (ct.includes('application/json')) {
              const j = await resp.json()
              detail = j?.error ? String(j.error) : JSON.stringify(j)
            } else {
              const t = await resp.text()
              detail = t ? String(t).trim().slice(0, 180) : ''
            }
          } catch {
            detail = ''
          }

          const redirected = resp.redirected ? ` redirected-to=${resp.url}` : ''
          const extra = detail ? ` — ${detail}` : ''
          throw new Error(`EPUB fetch failed (${resp.status})${redirected}${extra}`)
        }
        const blob = await resp.blob()
        const arrayBuffer = await blob.arrayBuffer()

        const book = ePub(arrayBuffer)
        bookRef.current = book

        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: 760,
          spread: 'none',
          flow: 'paginated',
          // Avoid about:srcdoc sandbox quirks that can prevent visible navigation updates.
          method: 'blobUrl',
          // epubjs injects helper scripts into the iframe; without allow-scripts some browsers won't update reliably.
          allowScriptedContent: true,
          allowPopups: false,
        })
        renditionRef.current = rendition

        const navigation = await book.loaded.navigation
        let nextToc = navigation.toc || []
        if (!nextToc.length) {
          // Fallback: build a simple chapter list from spine.
          await book.loaded.spine
          nextToc = (book.spine?.spineItems || []).map((it, idx) => ({
            href: it.href,
            label: it.idref || `Section ${idx + 1}`,
            subitems: [],
          }))
        }

        setToc(nextToc)
        if (nextToc[0]?.href) setSelectedTocHref(nextToc[0].href)

        await refreshEpubNotesAndBookmarks()

        const saved = await apiFetch('/api/epub/progress', { method: 'GET' })
        if (cancelled) {
          try { rendition.destroy() } catch (e) { void e }
          try { book.destroy() } catch (e) { void e }
          return
        }

        if (saved?.cfi) {
          await rendition.display(saved.cfi)
        } else {
          const firstHref = nextToc[0]?.href
          if (firstHref) {
            await rendition.display(firstHref)
          } else {
            await rendition.display()
          }
        }

        // Now that a section is rendered, apply theme + font settings.
        applyReaderStyles(rendition)

        // Ensure initial paint.
        await forceRenditionPaint()

        rendition.on('relocated', (location) => {
          try {
            const cfi = location?.start?.cfi
            const href = location?.start?.href
            const normHref = normalizeHref(href)
            setCurrentCfi(cfi || null)
            setCurrentChapterHref(normHref || null)

            const match = normHref ? tocByNormHrefRef.current.get(normHref) : null
            const title = match ? match.label.replace(/^—+/, '') : null
            setCurrentChapterTitle(title)

            // Avoid snapping the <select> back to the first option when href contains fragments.
            if (match?.href) setSelectedTocHref(match.href)
            if (cfi) scheduleSave(cfi, normHref, title)
          } catch {
            // ignore
          }
        })

        // Re-apply styles whenever epubjs renders a new section.
        rendition.on('rendered', () => {
          try {
            applyReaderStyles(renditionRef.current)
          } catch {
            // ignore
          }
        })

        // Capture selection text to power “selection → note”.
        rendition.on('selected', (cfiRange, contents) => {
          try {
            const text = (contents?.window?.getSelection?.()?.toString?.() || '').trim()
            if (!text) return
            setPendingSelection({ cfiRange, text })
            try {
              contents.window.getSelection().removeAllRanges()
            } catch {
              // ignore
            }
          } catch {
            // ignore
          }
        })

        if (!cancelled) setReady(true)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (readerSettingsTimerRef.current) clearTimeout(readerSettingsTimerRef.current)
      try {
        renditionRef.current?.destroy()
      } catch {
        // ignore
      }
      try {
        bookRef.current?.destroy()
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    applyReaderStyles(rendition)
    scheduleSaveReaderSettings({ theme: readerTheme, fontScale: readerFontScale, lineHeight: readerLineHeight })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerTheme, readerFontScale, readerLineHeight])

  useEffect(() => {
    if (!ready) return

    function isEditableTarget(target) {
      const el = target
      if (!el || typeof el !== 'object') return false
      const tag = String(el.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      return Boolean(el.isContentEditable)
    }

    function onKeyDown(e) {
      if (!e) return
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }

    function bindTarget(win) {
      if (!win || typeof win.addEventListener !== 'function') return
      const set = boundHotkeyTargetsRef.current
      if (set.has(win)) return
      win.addEventListener('keydown', onKeyDown)
      set.add(win)
    }

    function unbindAll() {
      const set = boundHotkeyTargetsRef.current
      for (const win of set) {
        try {
          win.removeEventListener('keydown', onKeyDown)
        } catch {
          // ignore
        }
      }
      set.clear()
    }

    // Bind to the top-level window.
    bindTarget(window)

    // Bind to any currently rendered EPUB iframe windows.
    try {
      const rendition = renditionRef.current
      const contentsList = rendition?.getContents?.() || []
      for (const c of contentsList) bindTarget(c?.window)
    } catch {
      // ignore
    }

    // And bind to new iframe windows as they render.
    const rendition = renditionRef.current
    const onRendered = (_section, contents) => {
      try {
        bindTarget(contents?.window)
      } catch {
        // ignore
      }
    }
    try {
      rendition?.on?.('rendered', onRendered)
    } catch {
      // ignore
    }

    return () => {
      try {
        rendition?.off?.('rendered', onRendered)
      } catch {
        // ignore
      }
      unbindAll()
    }
  }, [ready, goPrev, goNext])

  async function goPrev() {
    const rendition = renditionRef.current
    if (!rendition) return
    try {
      await rendition.prev()
      await forceRenditionPaint()
    } catch (e) {
      setError(e?.message || 'Navigation failed')
    }
  }

  async function goNext() {
    const rendition = renditionRef.current
    if (!rendition) return
    try {
      await rendition.next()
      await forceRenditionPaint()
    } catch (e) {
      setError(e?.message || 'Navigation failed')
    }
  }

  async function jumpToHref(href) {
    if (!href) return
    await safeDisplay(href)
  }

  async function addBookmark() {
    if (!currentCfi) return
    await apiFetch('/api/epub/bookmarks', {
      method: 'POST',
      body: JSON.stringify({
        cfi: currentCfi,
        label: bookmarkLabel || null,
        chapterHref: currentChapterHref,
        chapterTitle: currentChapterTitle,
      }),
    })
    setBookmarkLabel('')
    await refreshEpubNotesAndBookmarks()
  }

  async function addNote() {
    const cfi = (pendingSelection?.cfiRange || currentCfi || '').trim()
    const excerpt = (pendingSelection?.text || '').trim() || null
    if (!cfi || !noteText.trim()) return
    await apiFetch('/api/epub/notes', {
      method: 'POST',
      body: JSON.stringify({
        cfi,
        text: noteText.trim(),
        chapterHref: currentChapterHref,
        chapterTitle: currentChapterTitle,
        type: noteType || null,
        severity: noteSeverity || null,
        spoiler: Boolean(noteSpoiler),
        excerpt,
      }),
    })
    setNoteText('')
    setPendingSelection(null)
    await refreshEpubNotesAndBookmarks()
  }

  async function deleteBookmark(id) {
    await apiFetch(`/api/epub/bookmarks/${id}`, { method: 'DELETE' })
    await refreshEpubNotesAndBookmarks()
  }

  async function deleteNote(id) {
    await apiFetch(`/api/epub/notes/${id}`, { method: 'DELETE' })
    await refreshEpubNotesAndBookmarks()
  }

  async function editNote(id, text) {
    await apiFetch(`/api/epub/notes/${id}`, { method: 'PUT', body: JSON.stringify({ text }) })
    await refreshEpubNotesAndBookmarks()
  }

  async function goToCfi(cfi) {
    if (!cfi) return
    await safeDisplay(cfi)
  }

  const visibleNotes = useMemo(() => {
    if (!notesCurrentOnly) return notes
    if (!currentChapterHref) return notes
    const norm = normalizeHref(currentChapterHref)
    return notes.filter((n) => normalizeHref(n.chapterHref) === norm)
  }, [notes, notesCurrentOnly, currentChapterHref])

  if (error) {
    return (
      <div className="card cardRaised">
        <div className="cardHeader">
          <div className="eyebrow">Reading Room</div>
          <h1 className="pageTitle">Read</h1>
          <div className="titleRule" />
        </div>
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="grid12">
      <div className="colSpan7">
        <div className="card cardRaised">
          <div className="cardHeader">
            <div className="eyebrow">Reading Room</div>
            <h1 className="pageTitle">Read</h1>
            <div className="titleRule" />
          </div>
          <div className="tileMeta" style={{ marginTop: 10 }}>
            <span className={`chip ${ready ? 'chipAccent' : ''}`}>{ready ? 'Ready' : 'Loading'}</span>
            <span className="chip">Bookmarks</span>
            <span className="chip">Notes</span>
          </div>

          <div className="row" style={{ alignItems: 'end', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <div className="field" style={{ minWidth: 0, flex: '1 1 360px', marginBottom: 0, maxWidth: '100%' }}>
              <label>Chapter</label>
              <select
                value={selectedTocHref}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === selectedTocHref) return
                  setSelectedTocHref(next)
                  jumpToHref(next)
                }}
                disabled={!ready}
                style={{ width: '100%', maxWidth: '100%' }}
              >
                {tocOptions.map((t) => (
                  <option key={t.href} value={t.href}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="row" style={{ alignItems: 'end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="field" style={{ minWidth: 180, flex: '0 0 180px', marginBottom: 0 }}>
                <label>
                  Theme
                  <HelpTip text="Paper is warm and easy on the eyes; Night is best for dark rooms." />
                </label>
              <select value={readerTheme} onChange={(e) => setReaderTheme(e.target.value)} disabled={!ready}>
                <option value="paper">Paper</option>
                <option value="white">White</option>
                <option value="night">Night</option>
              </select>
            </div>

            <div className="field" style={{ minWidth: 180, flex: '0 0 180px', marginBottom: 0 }}>
                <label>
                  Font size
                  <HelpTip text="Adjusts the text size inside the reader." />
                </label>
              <select
                value={String(readerFontScale)}
                onChange={(e) => setReaderFontScale(Number(e.target.value))}
                disabled={!ready}
              >
                <option value={0.9}>Small</option>
                <option value={1.0}>Normal</option>
                <option value={1.1}>Large</option>
                <option value={1.25}>XL</option>
              </select>
            </div>

            <div className="field" style={{ minWidth: 180, flex: '0 0 180px', marginBottom: 0 }}>
                <label>
                  Line spacing
                  <HelpTip text="More spacing can make dense sections easier to read." />
                </label>
              <select
                value={String(readerLineHeight)}
                onChange={(e) => setReaderLineHeight(Number(e.target.value))}
                disabled={!ready}
              >
                <option value={1.4}>Tight</option>
                <option value={1.65}>Normal</option>
                <option value={1.9}>Relaxed</option>
                <option value={2.1}>Very relaxed</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card cardInset" style={{ padding: 14, marginTop: 16 }}>
          <div
            ref={viewerRef}
            style={{
              width: '100%',
              height: 760,
              background: readerTheme === 'night'
                ? 'var(--bg-0)'
                : (readerTheme === 'white'
                  ? '#fff'
                  : 'color-mix(in oklab, #fff 93%, var(--accent2) 7%)'),
              borderRadius: 12,
            }}
          />

          <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={goPrev} disabled={!ready}>Prev</button>
            <button onClick={goNext} disabled={!ready}>Next</button>
          </div>
        </div>
      </div>

      <div className="colSpan5">
        <div className="sideRail">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Bookmarks</h2>
              <span className="chip">{bookmarks.length}</span>
            </div>

            <div className="row" style={{ alignItems: 'end', marginTop: 10 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Label (optional)</label>
                <input value={bookmarkLabel} onChange={(e) => setBookmarkLabel(e.target.value)} placeholder="e.g. Great line" />
              </div>
              <button onClick={addBookmark} disabled={!ready || !currentCfi}>Add</button>
            </div>

            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {bookmarks.length === 0 ? <div className="muted">No bookmarks yet.</div> : null}
              {bookmarks.map((b) => (
                <div key={b.id} className="card cardInset" style={{ padding: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => goToCfi(b.cfi)}>
                      {(b.chapterTitle || 'Bookmark')}{b.label ? ` — ${b.label}` : ''}
                    </button>
                    <button onClick={() => deleteBookmark(b.id)} style={{ background: 'transparent' }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Notes</h2>
              <span className="chip">{visibleNotes.length}</span>
            </div>

            <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                {currentChapterTitle ? `Current: ${currentChapterTitle}` : 'Current: —'}
              </div>
              <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={notesCurrentOnly}
                  onChange={(e) => setNotesCurrentOnly(e.target.checked)}
                />
                Current only
              </label>
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label>New note</label>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note for feedback later…" />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                'pacing',
                'clarity',
                'character',
                'dialogue',
                'fact',
                'continuity',
                'typo',
                'love',
              ].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${noteType === t ? 'chipAccent' : ''}`}
                  onClick={() => setNoteType((prev) => (prev === t ? '' : t))}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="row" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: '0 0 180px' }}>
                <label>Severity</label>
                <select value={noteSeverity} onChange={(e) => setNoteSeverity(e.target.value)} disabled={!ready}>
                  <option value="">—</option>
                  <option value="minor">minor</option>
                  <option value="medium">medium</option>
                  <option value="major">major</option>
                </select>
              </div>
              <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
                <input type="checkbox" checked={noteSpoiler} onChange={(e) => setNoteSpoiler(e.target.checked)} disabled={!ready} />
                Spoiler
              </label>
            </div>

            {pendingSelection?.text ? (
              <div className="card cardInset" style={{ padding: 10, marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Selection captured</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{pendingSelection.text}</div>
                <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const q = pendingSelection.text
                      setNoteText((prev) => {
                        const base = (prev || '').trim()
                        const chunk = `> ${q.replace(/\n+/g, ' ').trim()}`
                        return base ? `${base}\n\n${chunk}\n` : `${chunk}\n`
                      })
                    }}
                    disabled={!ready}
                  >
                    Insert into note
                  </button>
                  <button type="button" onClick={() => setPendingSelection(null)} style={{ background: 'transparent' }}>
                    Clear
                  </button>
                </div>
              </div>
            ) : null}

            <button
              onClick={addNote}
              disabled={!ready || !(pendingSelection?.cfiRange || currentCfi) || !noteText.trim()}
            >
              Add note
            </button>

            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {visibleNotes.length === 0 ? <div className="muted">No notes for this view.</div> : null}
              {visibleNotes.map((n) => (
                <ReaderNoteRow
                  key={n.id}
                  note={n}
                  onGo={() => goToCfi(n.cfi)}
                  onDelete={() => deleteNote(n.id)}
                  onSave={(t) => editNote(n.id, t)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReaderNoteRow({ note, onGo, onDelete, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)

  return (
    <div className="card cardInset" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onGo}>{note.chapterTitle || 'Note'}</button>
          {note?.type ? <span className="chip">{note.type}</span> : null}
          {note?.severity ? <span className="chip">{note.severity}</span> : null}
          {note?.spoiler ? <span className="chip chipAccent">spoiler</span> : null}
        </div>
        <div className="row">
          <button
            onClick={() => {
              setEditing((v) => {
                const next = !v
                if (next) setText(note.text)
                return next
              })
            }}
            style={{ background: 'transparent' }}
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={onDelete} style={{ background: 'transparent' }}>Remove</button>
        </div>
      </div>

      {note?.excerpt ? (
        <div className="muted" style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          Excerpt: {note.excerpt}
        </div>
      ) : null}

      {editing ? (
        <div style={{ marginTop: 8 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button onClick={() => { onSave(text); setEditing(false) }} disabled={!text.trim()}>Save</button>
        </div>
      ) : (
        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{note.text}</div>
      )}
    </div>
  )
}
