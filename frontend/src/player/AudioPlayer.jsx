import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, apiUrl } from '../api.js'
import HelpTip from '../components/HelpTip.jsx'

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function IconLabel({ glyph, text }) {
  return (
    <>
      <span aria-hidden="true" className="iconGlyph">{glyph}</span>
      <span className="srOnly">{text}</span>
    </>
  )
}

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function resizeCanvasToDisplaySize(canvas) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const nextW = Math.max(1, Math.floor(rect.width * dpr))
  const nextH = Math.max(1, Math.floor(rect.height * dpr))
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW
    canvas.height = nextH
  }
}

function resolveCssColor(value, fallback = '#ffffff') {
  const v = String(value || '').trim()
  if (!v) return fallback
  try {
    const el = document.createElement('span')
    el.style.color = v
    el.style.position = 'absolute'
    el.style.left = '-9999px'
    el.style.top = '-9999px'
    document.body.appendChild(el)
    const computed = getComputedStyle(el).color
    document.body.removeChild(el)
    return computed || fallback
  } catch {
    return fallback
  }
}

export default function AudioPlayer() {
  const audioRef = useRef(null)
  const saveTimerRef = useRef(null)
  const sleepTimerRef = useRef(null)

  const visualizerCanvasRef = useRef(null)
  const visualizerRef = useRef({
    audioCtx: null,
    source: null,
    analyser: null,
    rafId: null,
    lastMs: 0,
    reducedMotion: false,
    resizeObs: null,
  })

  const resumeAppliedRef = useRef({ key: null, seconds: null })
  const timePollRef = useRef({ rafId: null, lastMs: 0 })

  const syncedScrollRef = useRef(null)

  const [manifest, setManifest] = useState({ bookTitle: 'The Enemy Within', chapters: [] })
  const [chapterId, setChapterId] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [progressByChapter, setProgressByChapter] = useState({})

  const [playbackRate, setPlaybackRate] = useState(() => {
    const raw = localStorage.getItem('listen.playbackRate')
    const v = Number(raw)
    return Number.isFinite(v) && v > 0 ? v : 1
  })
  const [jumpBackOnResume, setJumpBackOnResume] = useState(() => {
    return localStorage.getItem('listen.jumpBackOnResume') === '1'
  })

  const [showSyncedText, setShowSyncedText] = useState(false)
  const [syncedTextByChapter, setSyncedTextByChapter] = useState({})
  const [syncedTextError, setSyncedTextError] = useState(null)
  const [activeSyncedLine, setActiveSyncedLine] = useState(-1)

  const [bookmarks, setBookmarks] = useState([])
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('')
  const [noteSeverity, setNoteSeverity] = useState('')
  const [noteSpoiler, setNoteSpoiler] = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')

  const [sleepMinutes, setSleepMinutes] = useState(0)
  const [error, setError] = useState(null)

  const [showVisualizer, setShowVisualizer] = useState(() => {
    try {
      const raw = localStorage.getItem('listen.visualizer')
      if (raw == null) return true
      return raw === '1'
    } catch {
      return true
    }
  })

  const [visualizerError, setVisualizerError] = useState(null)

  const chapters = manifest.chapters || []
  const currentChapter = useMemo(() => chapters.find((c) => c.id === chapterId) || null, [chapters, chapterId])

  const chapterStreamUrl = useCallback((id) => {
    if (!id) return ''
    return apiUrl(`/api/audio/stream/${encodeURIComponent(id)}`)
  }, [])

  const syncedLines = useMemo(() => {
    const data = syncedTextByChapter[chapterId]
    return data && Array.isArray(data.lines) ? data.lines : []
  }, [syncedTextByChapter, chapterId])

  const timelineMarkers = useMemo(() => {
    const dur = Number(duration)
    if (!Number.isFinite(dur) || dur <= 0) return []

    const out = []
    for (const b of bookmarks || []) {
      const pos = Number(b.positionSeconds)
      if (!Number.isFinite(pos)) continue
      out.push({
        key: `b:${b.id}`,
        kind: 'bookmark',
        positionSeconds: pos,
        label: b.label ? String(b.label) : 'Bookmark',
      })
    }
    for (const n of notes || []) {
      const pos = Number(n.positionSeconds)
      if (!Number.isFinite(pos)) continue
      const preview = (n.text || '').trim().slice(0, 42)
      out.push({
        key: `n:${n.id}`,
        kind: 'note',
        positionSeconds: pos,
        label: preview ? `Note: ${preview}${preview.length >= 42 ? '…' : ''}` : 'Note',
      })
    }

    // Sort and dedupe markers that land on the same second.
    out.sort((a, b) => a.positionSeconds - b.positionSeconds)
    const deduped = []
    let lastBucket = null
    for (const m of out) {
      const bucket = Math.round(m.positionSeconds)
      if (bucket === lastBucket) continue
      lastBucket = bucket
      deduped.push(m)
    }
    return deduped
  }, [bookmarks, notes, duration])

  async function refreshProgress() {
    const data = await apiFetch('/api/progress', { method: 'GET' })
    const m = {}
    for (const item of data.items || []) {
      m[item.chapterId] = item.positionSeconds
    }
    setProgressByChapter(m)
    return data.items || []
  }

  function pickResumeChapter(items, fallbackChapters) {
    const list = Array.isArray(items) ? items : []
    const latest = list
      .filter((x) => x?.chapterId && x?.updatedAt)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    if (latest?.chapterId) return latest.chapterId
    const first = (fallbackChapters || [])[0]
    return first?.id || ''
  }

  async function refreshBookmarksAndNotes(id) {
    const [b, n] = await Promise.all([
      apiFetch(`/api/bookmarks?chapterId=${encodeURIComponent(id)}`, { method: 'GET' }),
      apiFetch(`/api/notes?chapterId=${encodeURIComponent(id)}`, { method: 'GET' }),
    ])
    setBookmarks(b.items || [])
    setNotes(n.items || [])
  }

  const saveProgressNow = useCallback(async (id, pos) => {
    await apiFetch('/api/progress', {
      method: 'POST',
      body: JSON.stringify({ chapterId: id, positionSeconds: pos }),
    })
  }, [])

  const ensureVisualizerGraph = useCallback(() => {
    const el = audioRef.current
    if (!el) return null
    const canvas = visualizerCanvasRef.current
    if (!canvas) return null

    const v = visualizerRef.current
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null

    if (!v.audioCtx) {
      v.audioCtx = new AudioCtx()
      v.reducedMotion = prefersReducedMotion()
    }

    if (!v.source) {
      try {
        v.source = v.audioCtx.createMediaElementSource(el)
      } catch {
        v.source = null
      }
    }

    if (!v.source) {
      setVisualizerError('Visualizer unavailable for this audio source (browser limitation).')
      return null
    }

    if (!v.analyser) {
      const analyser = v.audioCtx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.86
      v.source.connect(analyser)
      analyser.connect(v.audioCtx.destination)
      v.analyser = analyser
    }

    setVisualizerError(null)

    return { audioCtx: v.audioCtx, analyser: v.analyser }
  }, [])

  const startVisualizerLoop = useCallback(() => {
    const canvas = visualizerCanvasRef.current
    const graph = ensureVisualizerGraph()
    if (!canvas || !graph?.analyser) return

    const v = visualizerRef.current
    if (v.rafId) return

    const analyser = graph.analyser
    const buf = new Uint8Array(analyser.frequencyBinCount)

    // Resolve CSS variables to a canvas-friendly color string (rgb() on most browsers).
    const accentRaw = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim()
    const accent = resolveCssColor(accentRaw, '#ffffff')

    const draw = (ms) => {
      const v2 = visualizerRef.current
      v2.rafId = requestAnimationFrame(draw)

      const minInterval = v2.reducedMotion ? 250 : 50 // ~4fps vs ~20fps
      if (v2.lastMs && ms - v2.lastMs < minInterval) return
      v2.lastMs = ms

      const c = visualizerCanvasRef.current
      if (!c) return

      resizeCanvasToDisplaySize(c)
      const ctx = c.getContext('2d')
      if (!ctx) return

      const w = c.width
      const h = c.height
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)

      analyser.getByteFrequencyData(buf)

      ctx.globalAlpha = 0.92
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, accent)
      grad.addColorStop(1, 'rgba(255,255,255,0.0)')
      ctx.fillStyle = grad

      const barCount = Math.max(20, Math.min(64, Math.floor(w / 14)))
      const gap = Math.max(2, Math.floor(w / (barCount * 14)))
      const barW = Math.max(2, Math.floor((w - gap * (barCount - 1)) / barCount))

      // Use the lower half of the spectrum for a calmer look.
      const startBin = 2
      const endBin = Math.max(startBin + 1, Math.floor(buf.length * 0.55))
      const span = Math.max(1, endBin - startBin)
      const binsPerBar = Math.max(1, Math.floor(span / barCount))

      const maxH = h * 0.88
      for (let i = 0; i < barCount; i++) {
        const b0 = startBin + i * binsPerBar
        const b1 = Math.min(endBin, b0 + binsPerBar)
        let sum = 0
        let n = 0
        for (let j = b0; j < b1; j++) {
          sum += buf[j]
          n++
        }
        const avg = n ? sum / n : 0
        // Light compression for a nicer “always moving” look.
        const t = Math.pow(avg / 255, 0.78)
        const bh = Math.max(1, Math.floor(t * maxH))
        const x = i * (barW + gap)
        const y = h - bh
        const r = Math.min(999, Math.floor(barW / 2))

        ctx.beginPath()
        // rounded rect
        ctx.moveTo(x + r, y)
        ctx.arcTo(x + barW, y, x + barW, y + bh, r)
        ctx.arcTo(x + barW, y + bh, x, y + bh, r)
        ctx.arcTo(x, y + bh, x, y, r)
        ctx.arcTo(x, y, x + barW, y, r)
        ctx.closePath()
        ctx.fill()
      }
    }

    v.rafId = requestAnimationFrame(draw)
  }, [ensureVisualizerGraph])

  const stopVisualizerLoop = useCallback(() => {
    const v = visualizerRef.current
    if (v.rafId) cancelAnimationFrame(v.rafId)
    v.rafId = null
    v.lastMs = 0
    const c = visualizerCanvasRef.current
    if (c) {
      const ctx = c.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, c.width, c.height)
    }
  }, [])

  const seekTo = useCallback(async (val) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = val
    setCurrentTime(val)
    if (chapterId) await saveProgressNow(chapterId, val)
  }, [chapterId, saveProgressNow])

  const togglePlay = useCallback(async () => {
    const el = audioRef.current
    if (!el) return
    // If the visualizer is enabled, ensure the graph is initialized from a user gesture
    // (helps Safari/iOS where AudioContext resume must be user-initiated).
    if (showVisualizer) {
      const g = ensureVisualizerGraph()
      try {
        await g?.audioCtx?.resume?.()
      } catch {
        // ignore
      }
    }
    if (el.paused) {
      try {
        await el.play()
        setPlaying(true)
      } catch (e) {
        const msg = e && typeof e === 'object' && 'message' in e ? e.message : String(e)
        console.error('Audio play() failed:', e)
        setError(`Playback failed: ${msg}`)
      }
    } else {
      el.pause()
      setPlaying(false)
      if (chapterId) await saveProgressNow(chapterId, el.currentTime)
    }
  }, [chapterId, saveProgressNow, showVisualizer, ensureVisualizerGraph])

  function scheduleProgressSave(id, pos) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveProgressNow(id, pos).catch(() => {})
    }, 1200)
  }

  useEffect(() => {
    ;(async () => {
      try {
        setError(null)
        const m = await apiFetch('/api/audio/manifest', { method: 'GET' })
        setManifest(m)
        const progressItems = await refreshProgress()

        const resumeId = pickResumeChapter(progressItems, m.chapters || [])
        if (resumeId) {
          const ch = (m.chapters || []).find((c) => c.id === resumeId) || (m.chapters || [])[0]
          if (ch) {
            setChapterId(ch.id)
            setAudioUrl(chapterStreamUrl(ch.id))
            await refreshBookmarksAndNotes(ch.id)
          }
        }
      } catch (e) {
        setError(e.message)
      }
    })()

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current)
    }
  }, [chapterStreamUrl])

  useEffect(() => {
    if (!chapterId) return
    const ch = chapters.find((c) => c.id === chapterId)
    if (!ch) return
    const t = setTimeout(() => {
      setAudioUrl(chapterStreamUrl(chapterId))
      refreshBookmarksAndNotes(chapterId).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [chapterId, chapters, chapterStreamUrl])

  useEffect(() => {
    if (!showSyncedText || !chapterId) return

    // Cache per-chapter in memory.
    if (syncedTextByChapter[chapterId]) return

    ;(async () => {
      try {
        setSyncedTextError(null)
        const data = await apiFetch(`/api/audio/synced-text/${encodeURIComponent(chapterId)}`, { method: 'GET' })
        setSyncedTextByChapter((m) => ({ ...m, [chapterId]: data }))
      } catch (e) {
        setSyncedTextError(e.message)
      }
    })()
  }, [showSyncedText, chapterId, syncedTextByChapter])

  useEffect(() => {
    if (!showSyncedText) {
      const t = setTimeout(() => setActiveSyncedLine(-1), 0)
      return () => clearTimeout(t)
    }
    if (!syncedLines.length) {
      const t = setTimeout(() => setActiveSyncedLine(-1), 0)
      return () => clearTimeout(t)
    }

    const t = Number.isFinite(currentTime) ? currentTime : 0

    const EPS = 0.08

    const effectiveEnd = (i) => {
      const start = Number(syncedLines[i]?.startSeconds)
      const endFromData = Number(syncedLines[i]?.endSeconds)
      const nextStart = Number(syncedLines[i + 1]?.startSeconds)
      if (Number.isFinite(endFromData)) return endFromData
      if (Number.isFinite(nextStart)) return nextStart
      return Number.isFinite(start) ? start + 8 : t + 8
    }

    // Binary search: last startSeconds <= t
    let lo = 0
    let hi = syncedLines.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const s = Number(syncedLines[mid]?.startSeconds)
      if (Number.isFinite(s) && s <= t) lo = mid + 1
      else hi = mid
    }
    let idx = Math.max(0, Math.min(syncedLines.length - 1, lo - 1))

    // Ensure t is in [start, end). If we're past end (minus EPS), walk forward.
    while (idx < syncedLines.length - 1 && t >= (effectiveEnd(idx) - EPS)) idx++

    if (idx !== activeSyncedLine) {
      const t2 = setTimeout(() => setActiveSyncedLine(idx), 0)
      return () => clearTimeout(t2)
    }
  }, [showSyncedText, syncedLines, currentTime, activeSyncedLine])

  useEffect(() => {
    if (!showSyncedText) return
    if (activeSyncedLine < 0) return

    const container = syncedScrollRef.current
    if (!container) return
    const el = container.querySelector(`[data-sync-line="${activeSyncedLine}"]`)
    if (!el) return

    // Keep the current line in view (simple "page flip" behaviour).
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [showSyncedText, activeSyncedLine])

  useEffect(() => {
    const el = audioRef.current
    if (!el || !chapterId) return

    let t = null

    const saved = progressByChapter[chapterId]
    if (Number.isFinite(saved) && saved > 0) {
      const key = `${chapterId}:${audioUrl}`
      const already = resumeAppliedRef.current
      const shouldApplyJumpBack = jumpBackOnResume && (already.key !== key || already.seconds !== saved)
      const target = shouldApplyJumpBack ? Math.max(0, Number(saved) - 10) : Number(saved)
      try {
        el.currentTime = target
        t = setTimeout(() => setCurrentTime(target), 0)
        resumeAppliedRef.current = { key, seconds: saved }
      } catch {
        // ignore
      }
    }

    return () => {
      if (t) clearTimeout(t)
    }
  }, [audioUrl, chapterId, progressByChapter, jumpBackOnResume])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
    el.volume = v
  }, [volume])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const r = Number.isFinite(playbackRate) ? Math.min(3, Math.max(0.5, playbackRate)) : 1
    el.playbackRate = r
  }, [playbackRate])

  useEffect(() => {
    const canvas = visualizerCanvasRef.current
    if (!canvas) return
    const v = visualizerRef.current

    // Watch for layout changes so the canvas stays crisp.
    if (!v.resizeObs && 'ResizeObserver' in window) {
      v.resizeObs = new ResizeObserver(() => {
        resizeCanvasToDisplaySize(canvas)
      })
      v.resizeObs.observe(canvas)
    }

    return () => {
      try {
        v.resizeObs?.disconnect?.()
      } catch {
        // ignore
      }
      v.resizeObs = null
    }
  }, [])

  useEffect(() => {
    if (!showVisualizer) {
      stopVisualizerLoop()
      return
    }
    if (!playing) {
      stopVisualizerLoop()
      return
    }
    startVisualizerLoop()
    return () => stopVisualizerLoop()
  }, [showVisualizer, playing, startVisualizerLoop, stopVisualizerLoop])

  useEffect(() => {
    // Cleanup on unmount.
    const v = visualizerRef.current
    return () => {
      stopVisualizerLoop()
      try {
        v.analyser?.disconnect?.()
      } catch {
        // ignore
      }
      try {
        v.source?.disconnect?.()
      } catch {
        // ignore
      }
      try {
        v.audioCtx?.close?.()
      } catch {
        // ignore
      }
      v.analyser = null
      v.source = null
      v.audioCtx = null
    }
  }, [stopVisualizerLoop])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (!chapterId || !audioUrl) return

    // `timeupdate` events can be infrequent (and feel worse at higher playbackRate).
    // Poll currentTime while playing or when synced text is visible to keep highlight tight.
    if (!playing && !showSyncedText) return

    let cancelled = false
    const state = timePollRef.current
    state.lastMs = 0

    const tick = (ms) => {
      if (cancelled) return
      const last = Number(state.lastMs) || 0
      // Throttle to ~10Hz to avoid excessive rerenders.
      if (!last || ms - last >= 100) {
        state.lastMs = ms
        const t = el.currentTime
        if (Number.isFinite(t)) {
          setCurrentTime((prev) => {
            if (!Number.isFinite(prev)) return t
            return Math.abs(prev - t) >= 0.03 ? t : prev
          })
        }
      }
      state.rafId = requestAnimationFrame(tick)
    }

    state.rafId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (state.rafId) cancelAnimationFrame(state.rafId)
      state.rafId = null
    }
  }, [playing, showSyncedText, chapterId, audioUrl])

  useEffect(() => {
    function isTypingTarget(t) {
      const tag = (t?.tagName || '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable
    }

    async function stepChapter(delta) {
      const idx = chapters.findIndex((c) => c.id === chapterId)
      if (idx < 0) return
      const next = chapters[idx + delta]
      if (!next) return
      setChapterId(next.id)
    }

    async function onKeyDown(e) {
      if (!audioUrl) return
      if (isTypingTarget(e.target)) return

      if (e.code === 'Space') {
        e.preventDefault()
        await togglePlay()
        return
      }

      const k = String(e.key || '').toLowerCase()
      if (k === 'j') {
        e.preventDefault()
        await seekTo(Math.max(0, currentTime - 15))
      } else if (k === 'k') {
        e.preventDefault()
        await seekTo(Math.min(duration || currentTime + 30, currentTime + 30))
      } else if (k === 'n') {
        e.preventDefault()
        await stepChapter(1)
      } else if (k === 'p') {
        e.preventDefault()
        await stepChapter(-1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [audioUrl, chapters, chapterId, currentTime, duration, seekTo, togglePlay])

  function computeLineProgress(ln, i) {
    if (i !== activeSyncedLine) return 0
    const start = Number(ln.startSeconds)
    const endFromData = Number(ln.endSeconds)
    const nextStart = Number(syncedLines[i + 1]?.startSeconds)
    const end = Number.isFinite(endFromData)
      ? endFromData
      : (Number.isFinite(nextStart)
        ? nextStart
        : (Number.isFinite(start)
          ? start + 8
          : currentTime + 8))
    const denom = Math.max(0.001, end - (Number.isFinite(start) ? start : 0))
    const local = (Number.isFinite(start) ? (currentTime - start) : 0)
    return Math.min(1, Math.max(0, local / denom))
  }

  function onTimeUpdate() {
    const el = audioRef.current
    if (!el || !chapterId) return
    setCurrentTime(el.currentTime)
    scheduleProgressSave(chapterId, el.currentTime)
  }

  function onLoadedMetadata() {
    const el = audioRef.current
    if (!el) return
    setDuration(el.duration || 0)
    // Ensure UI time matches actual element time after load/seek.
    if (Number.isFinite(el.currentTime)) setCurrentTime(el.currentTime)
  }

  async function diagnoseAudioSrc(src) {
    const url = String(src || '').trim()
    if (!url) return null

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 9000)
    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
      })
      const ct = resp.headers.get('content-type') || ''
      let snippet = ''
      try {
        if (ct.toLowerCase().includes('application/json')) {
          const j = await resp.json()
          snippet = j?.error ? String(j.error) : JSON.stringify(j)
        } else {
          snippet = (await resp.text()).trim().slice(0, 140)
        }
      } catch {
        snippet = ''
      }
      return {
        status: resp.status,
        ok: resp.ok,
        contentType: ct,
        snippet,
      }
    } finally {
      clearTimeout(t)
    }
  }


  function onAudioError() {
    const el = audioRef.current
    const mediaError = el?.error
    const code = mediaError?.code
    const map = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    }
    const label = code ? (map[code] || `MEDIA_ERR_${code}`) : 'Unknown media error'
    console.error('Audio element error:', { label, mediaError, src: el?.src })

    // Try to surface the underlying HTTP response (401/404/HTML/etc).
    const src = el?.currentSrc || el?.src || ''
    diagnoseAudioSrc(src)
      .then((d) => {
        if (!d) {
          setError(`Audio error: ${label}`)
          return
        }
        const extra = d.snippet ? ` — ${d.snippet}` : ''
        setError(`Audio error: ${label} (HTTP ${d.status}, ${d.contentType || 'unknown type'})${extra}`)
      })
      .catch(() => setError(`Audio error: ${label}`))
  }

  async function addBookmark() {
    if (!chapterId) return
    await apiFetch('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ chapterId, positionSeconds: currentTime, label: bookmarkLabel || null }),
    })
    setBookmarkLabel('')
    await refreshBookmarksAndNotes(chapterId)
  }

  async function addNote() {
    if (!chapterId || !noteText.trim()) return
    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        positionSeconds: currentTime,
        text: noteText.trim(),
        type: noteType || null,
        severity: noteSeverity || null,
        spoiler: Boolean(noteSpoiler),
      }),
    })
    setNoteText('')
    await refreshBookmarksAndNotes(chapterId)
  }

  async function deleteBookmark(id) {
    await apiFetch(`/api/bookmarks/${id}`, { method: 'DELETE' })
    await refreshBookmarksAndNotes(chapterId)
  }

  async function deleteNote(id) {
    await apiFetch(`/api/notes/${id}`, { method: 'DELETE' })
    await refreshBookmarksAndNotes(chapterId)
  }

  async function editNote(id, text) {
    await apiFetch(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ text }) })
    await refreshBookmarksAndNotes(chapterId)
  }

  function setSleepTimer(minutes) {
    setSleepMinutes(minutes)
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current)
    sleepTimerRef.current = null
    if (!minutes) return
    sleepTimerRef.current = setTimeout(() => {
      const el = audioRef.current
      if (!el) return
      el.pause()
      setPlaying(false)
    }, minutes * 60 * 1000)
  }

  function setRate(next) {
    const r = Number(next)
    const safe = Number.isFinite(r) ? Math.min(3, Math.max(0.5, r)) : 1
    setPlaybackRate(safe)
    try {
      localStorage.setItem('listen.playbackRate', String(safe))
    } catch {
      // ignore
    }
  }

  function toggleJumpBack(val) {
    const on = Boolean(val)
    setJumpBackOnResume(on)
    try {
      localStorage.setItem('listen.jumpBackOnResume', on ? '1' : '0')
    } catch {
      // ignore
    }
  }

  if (error) {
    return <div className="card"><div className="error">{error}</div></div>
  }

  return (
    <div className="grid12">
      <div className="colSpan7">
        <div className="card cardRaised">
          <div className="cardHeader">
            <div className="eyebrow">Listening Room</div>
            <h1 className="pageTitle">{manifest.bookTitle || 'The Enemy Within'}</h1>
            <div className="titleRule" />
          </div>

          <div className="row" style={{ alignItems: 'end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="field" style={{ minWidth: 280, flex: '1 1 280px', marginBottom: 0 }}>
              <label>Chapter</label>
              <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                {(chapters || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>

            <div className="field" style={{ minWidth: 200, flex: '0 0 200px', marginBottom: 0 }}>
              <label>
                Synced text
                <HelpTip text="Shows the current line as the audio plays. Useful for catching exact moments." />
              </label>
              <div className="row" style={{ alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={showSyncedText}
                  onChange={(e) => setShowSyncedText(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <div className="muted">Show / hide</div>
              </div>
            </div>

            <div className="field" style={{ minWidth: 200, flex: '0 0 200px', marginBottom: 0 }}>
              <label>
                Visualizer
                <HelpTip text="Animated spectrum display. Toggle off if you prefer less motion." />
              </label>
              <div className="row" style={{ alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={showVisualizer}
                  onChange={async (e) => {
                    const on = e.target.checked
                    setShowVisualizer(on)
                    try {
                      localStorage.setItem('listen.visualizer', on ? '1' : '0')
                    } catch {
                      // ignore
                    }

                    if (on) {
                      const g = ensureVisualizerGraph()
                      try {
                        await g?.audioCtx?.resume?.()
                      } catch {
                        // ignore
                      }
                      if (playing) startVisualizerLoop()
                    } else {
                      stopVisualizerLoop()
                    }
                  }}
                  style={{ width: 18, height: 18 }}
                />
                <div className="muted">Show / hide</div>
              </div>
            </div>

            <div className="field" style={{ minWidth: 200, flex: '0 0 200px', marginBottom: 0 }}>
              <label>
                Sleep timer
                <HelpTip text="Stops playback after a set time." />
              </label>
              <select value={sleepMinutes} onChange={(e) => setSleepTimer(Number(e.target.value))}>
                <option value={0}>Off</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 650 }}>{currentChapter?.title || 'Chapter'}</div>
            <div className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div className="wavePlaceholder" aria-hidden="true" style={{ marginTop: 12 }}>
            {showVisualizer ? (
              <>
                <canvas
                  ref={visualizerCanvasRef}
                  className="waveVisualizerCanvas"
                />
                {visualizerError ? (
                  <div className="muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, padding: '0 12px', textAlign: 'center' }}>
                    {visualizerError}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="tapeRangeWrap" style={{ marginTop: 10 }}>
            <input
              className="tapeRange"
              style={{ width: '100%' }}
              type="range"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 0}
              value={Number.isFinite(currentTime) ? currentTime : 0}
              step={1}
              onChange={(e) => seekTo(Number(e.target.value))}
            />

            {timelineMarkers.length ? (
              <div className="tapeMarkers" aria-label="Timeline markers">
                {timelineMarkers.map((m) => {
                  const leftPct = Math.min(100, Math.max(0, (m.positionSeconds / Number(duration)) * 100))
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className={`tapeMarker ${m.kind === 'bookmark' ? 'tapeMarkerBookmark' : 'tapeMarkerNote'}`}
                      style={{ left: `${leftPct}%` }}
                      title={`${formatTime(m.positionSeconds)} — ${m.label}`}
                      aria-label={`${m.kind === 'bookmark' ? 'Bookmark' : 'Note'} at ${formatTime(m.positionSeconds)}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => seekTo(m.positionSeconds)}
                    />
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={togglePlay} disabled={!audioUrl} aria-label={playing ? 'Pause' : 'Play'}>
              <IconLabel glyph={playing ? '❚❚' : '▶'} text={playing ? 'Pause' : 'Play'} />
            </button>
            <button onClick={() => seekTo(Math.max(0, currentTime - 15))} disabled={!audioUrl} aria-label="Back 15 seconds">
              <span aria-hidden="true" className="iconGlyph">
                ↺<span className="iconSub">15</span>
              </span>
            </button>
            <button onClick={() => seekTo(Math.min(duration || currentTime + 30, currentTime + 30))} disabled={!audioUrl} aria-label="Forward 30 seconds">
              <span aria-hidden="true" className="iconGlyph">
                ↻<span className="iconSub">30</span>
              </span>
            </button>
          </div>

          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 13 }}>Speed</span>
              {[0.5, 0.9, 1.0, 1.1, 1.25, 2.0].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip ${Math.abs((playbackRate || 1) - r) < 0.001 ? 'chipAccent' : ''}`}
                  onClick={() => setRate(r)}
                >
                  {r === 1 ? '1x' : `${r}x`}
                </button>
              ))}
            </div>

            <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={jumpBackOnResume}
                onChange={(e) => toggleJumpBack(e.target.checked)}
              />
              <span>
                Jump back 10s on resume
                <HelpTip text="When you resume a chapter, rewinds slightly so you regain context." />
              </span>
            </label>
          </div>

          <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
            <div className="muted" style={{ minWidth: 24 }} aria-label="Volume">
              <span aria-hidden="true" className="iconGlyph">🔊</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={Number.isFinite(volume) ? volume : 1}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ width: '100%' }}
              aria-label="Volume"
            />
          </div>

          <audio
            ref={audioRef}
            crossOrigin="use-credentials"
            src={audioUrl}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onError={onAudioError}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            style={{ width: '100%', marginTop: 10 }}
          />

          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div className="tileMeta" style={{ margin: 0 }}>
              <span className="chip">Now playing</span>
              <span className="chip chipAccent">{currentChapter?.title || '—'}</span>
              <span className="chip">Synced: {showSyncedText ? 'on' : 'off'}</span>
              <span className="chip">Speed: {Number.isFinite(playbackRate) ? playbackRate : 1}x</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Space play/pause · J/K seek · N/P chapter
            </div>
          </div>
        </div>

        <div className="sectionGrid" style={{ marginTop: 16 }}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Bookmarks</h2>
            <div className="row" style={{ alignItems: 'end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Label (optional)</label>
                <input value={bookmarkLabel} onChange={(e) => setBookmarkLabel(e.target.value)} placeholder="e.g. Great line" />
              </div>
              <button onClick={addBookmark} disabled={!chapterId}>Add bookmark</button>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {bookmarks.length === 0 ? <div className="muted">No bookmarks yet.</div> : null}
              {bookmarks.map((b) => (
                <div key={b.id} className="card cardInset" style={{ padding: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => seekTo(Number(b.positionSeconds))}>
                      {formatTime(Number(b.positionSeconds))}{b.label ? ` — ${b.label}` : ''}
                    </button>
                    <button onClick={() => deleteBookmark(b.id)} style={{ background: 'transparent' }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Notes</h2>
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
                <select value={noteSeverity} onChange={(e) => setNoteSeverity(e.target.value)}>
                  <option value="">—</option>
                  <option value="minor">minor</option>
                  <option value="medium">medium</option>
                  <option value="major">major</option>
                </select>
              </div>
              <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
                <input type="checkbox" checked={noteSpoiler} onChange={(e) => setNoteSpoiler(e.target.checked)} />
                Spoiler
              </label>
            </div>

            <div className="field">
              <label>New note (saved with timestamp)</label>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note for feedback later…" />
            </div>
            <button onClick={addNote} disabled={!noteText.trim() || !chapterId}>Add note</button>

            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {notes.length === 0 ? <div className="muted">No notes yet.</div> : null}
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} onSeek={() => seekTo(Number(n.positionSeconds))} onDelete={() => deleteNote(n.id)} onSave={(t) => editNote(n.id, t)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="colSpan5">
        <div className="card cardInset" style={{ padding: 14 }}>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 650 }}>Read-along</div>
            <span className={`chip ${showSyncedText ? 'chipAccent' : ''}`}>Synced</span>
          </div>

          {!showSyncedText ? (
            <div className="muted">Enable “Synced text” to show the current line as you listen.</div>
          ) : (
            <>
              {syncedTextError ? <div className="error">{syncedTextError}</div> : null}
              {!syncedTextError && syncedLines.length === 0 ? <div className="muted">No synced text available for this chapter.</div> : null}
              {syncedLines.length ? (
                <div ref={syncedScrollRef} className="syncedTextPanel" style={{ maxHeight: 520 }}>
                  {syncedLines.map((ln, i) => (
                    <div
                      key={i}
                      data-sync-line={i}
                      className={
                        i === activeSyncedLine
                          ? 'syncedLine syncedLineActive'
                          : i < activeSyncedLine
                            ? 'syncedLine syncedLinePast'
                            : 'syncedLine syncedLineFuture'
                      }
                      style={i === activeSyncedLine ? { '--p': computeLineProgress(ln, i) } : undefined}
                    >
                      {ln.text}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function NoteRow({ note, onSeek, onDelete, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)

  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onSeek}>{formatTime(Number(note.positionSeconds))}</button>
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
