import TopNav from '../components/TopNav.jsx'
import { NavLink } from 'react-router-dom'

export default function HelpOverviewPage() {
  return (
    <>
      <TopNav />
      <div className="container page">
        <div className="card cardRaised">
          <div className="cardHeader">
            <div className="eyebrow">Help</div>
            <h1 className="pageTitle">Get started fast</h1>
            <div className="titleRule" />
          </div>

          <h2 style={{ marginTop: 0 }}>Quick start (60 seconds)</h2>
          <ol className="helpList">
            <li>
              Go to <strong>Listen</strong> or <strong>Read</strong>.
            </li>
            <li>
              When something stands out, add a <strong>Note</strong> (with a type like pacing/clarity/etc).
            </li>
            <li>
              Use <strong>Bookmarks</strong> for “come back later” moments.
            </li>
            <li>
              When you’re done, go to <strong>Feedback</strong> and paste in your notes (or use the template).
            </li>
          </ol>

          <div className="helpCallout">
            <div style={{ fontWeight: 650 }}>Most helpful feedback</div>
            <div className="muted" style={{ marginTop: 4 }}>
              Tell me <strong>where</strong> (chapter + moment), <strong>what you felt</strong> (confusion, drag, delight), and
              <strong> why</strong>.
            </div>
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <NavLink className="btn btnPrimary" to="/app/listen">Start listening</NavLink>
            <NavLink className="btn btnSecondary" to="/app/read">Start reading</NavLink>
            <NavLink className="btn btnSecondary" to="/app/feedback">Leave feedback</NavLink>
          </div>

          <hr className="helpRule" />

          <h2>Full help</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Want details on every control and feature?
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <NavLink className="btn btnSecondary" to="/app/help/features">All features</NavLink>
          </div>
        </div>
      </div>
    </>
  )
}
