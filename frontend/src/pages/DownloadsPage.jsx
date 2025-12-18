import { useEffect, useState } from 'react'
import TopNav from '../components/TopNav.jsx'
import { apiFetch, apiUrl } from '../api.js'

export default function DownloadsPage() {
  const [links, setLinks] = useState({ epub: null, pdf: null })
  const [buildInfo, setBuildInfo] = useState({ draftVersion: 'v0', updatedAt: null, whatChanged: [] })
  const [error, setError] = useState(null)

  const epubHref = links.epub ? apiUrl(links.epub) : null
  const pdfHref = links.pdf ? apiUrl(links.pdf) : null

  useEffect(() => {
    Promise.all([
      apiFetch('/api/book/downloads', { method: 'GET' }),
      apiFetch('/api/build-info', { method: 'GET' }),
    ])
      .then(([l, bi]) => {
        setLinks(l)
        setBuildInfo(bi || { draftVersion: 'v0', updatedAt: null, whatChanged: [] })
      })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <TopNav />
      <div className="container page">
        <div className="card cardRaised" style={{ marginBottom: 16 }}>
          <div className="cardHeader">
            <div className="eyebrow">Case Files</div>
            <h1 className="pageTitle">Downloads</h1>
            <div className="titleRule" />
          </div>
          <div className="tileMeta" style={{ marginTop: 10 }}>
            <span className="chip chipAccent">Latest build</span>
            <span className="chip">Draft: {buildInfo?.draftVersion || 'v0'}</span>
            <span className="chip">Updated: {buildInfo?.updatedAt || '—'}</span>
            <span className="chip">Invite-only access</span>
          </div>
          <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
            If a format is unavailable, it hasn’t been uploaded yet.
          </p>
          {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
        </div>

        <div className="tiles">
          <div className="card">
            <div className="tileHeader">
              <h2 style={{ margin: 0 }}>EPUB</h2>
              <div className="tileMeta">
                <span>Best for e-readers</span>
                <span>•</span>
                <span>Reflowable</span>
              </div>
            </div>
            <div className="row">
              <a
                className={`btn ${links.epub ? 'btnPrimary' : 'btnSecondary'}`}
                href={epubHref || '#'}
                aria-disabled={epubHref ? 'false' : 'true'}
                onClick={(e) => {
                  if (!epubHref) e.preventDefault()
                }}
              >
                Download EPUB
              </a>
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
              {links.epub ? 'Opens a direct download.' : 'Not uploaded yet.'}
            </p>
          </div>

          <div className="card">
            <div className="tileHeader">
              <h2 style={{ margin: 0 }}>PDF</h2>
              <div className="tileMeta">
                <span>Printable</span>
                <span>•</span>
                <span>Fixed layout</span>
              </div>
            </div>
            <div className="row">
              <a
                className={`btn ${links.pdf ? 'btnPrimary' : 'btnSecondary'}`}
                href={pdfHref || '#'}
                aria-disabled={pdfHref ? 'false' : 'true'}
                onClick={(e) => {
                  if (!pdfHref) e.preventDefault()
                }}
              >
                Download PDF
              </a>
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
              {links.pdf ? 'Opens a direct download.' : 'Not uploaded yet.'}
            </p>
          </div>
        </div>

        {(buildInfo?.whatChanged || []).length ? (
          <div className="card cardInset" style={{ marginTop: 16, padding: 14 }}>
            <h2 style={{ marginTop: 0 }}>What changed</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {(buildInfo.whatChanged || []).slice(0, 6).map((x) => (
                <div key={x} className="muted" style={{ fontSize: 13 }}>• {x}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
