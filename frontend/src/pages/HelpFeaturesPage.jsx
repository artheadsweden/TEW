import TopNav from '../components/TopNav.jsx'
import { NavLink } from 'react-router-dom'

function Section({ title, children }) {
  return (
    <section className="helpSection">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="helpBody">{children}</div>
    </section>
  )
}

export default function HelpFeaturesPage() {
  return (
    <>
      <TopNav />
      <div className="container page">
        <div className="card cardRaised">
          <div className="cardHeader">
            <div className="eyebrow">Help</div>
            <h1 className="pageTitle">All features</h1>
            <div className="titleRule" />
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <NavLink className="btn btnSecondary" to="/app/help">Back to quick start</NavLink>
            <NavLink className="btn btnSecondary" to="/app">Home</NavLink>
          </div>

          <Section title="Listen">
            <ul className="helpBullets">
              <li><strong>Chapter picker</strong>: jump between chapters.</li>
              <li><strong>Timeline scrubber</strong>: drag to seek; markers show bookmarks/notes.</li>
              <li><strong>Synced text</strong>: shows the current line while audio plays.</li>
              <li><strong>Speed</strong>: choose a preset speed; it’s remembered.</li>
              <li><strong>Jump back 10s</strong>: when resuming, rewinds slightly so you regain context.</li>
              <li><strong>Sleep timer</strong>: stops playback after a set time.</li>
              <li><strong>Visualizer</strong>: optional animated spectrum display.</li>
              <li><strong>Keyboard</strong>: Space play/pause; J/K seek; N/P change chapter.</li>
            </ul>
          </Section>

          <Section title="Read">
            <ul className="helpBullets">
              <li><strong>Table of contents</strong>: jump to sections quickly.</li>
              <li><strong>Comfort controls</strong>: theme (Paper/White/Night), font size, line spacing.</li>
              <li><strong>Selection → note</strong>: select text and attach it to a note excerpt.</li>
              <li><strong>Bookmarks</strong>: save your place and return later.</li>
            </ul>
          </Section>

          <Section title="Notes">
            <ul className="helpBullets">
              <li><strong>Types</strong> (pacing/clarity/etc) help you categorize feedback.</li>
              <li><strong>Severity</strong> helps you flag what matters most.</li>
              <li><strong>Spoiler</strong> lets you mark notes that reveal plot.</li>
            </ul>
          </Section>

          <Section title="Feedback">
            <ul className="helpBullets">
              <li><strong>Template</strong>: inserts structured headings so it’s easier to be specific.</li>
              <li><strong>Ratings</strong>: quick numeric scores for clarity/pacing/characters.</li>
              <li><strong>Insert notes</strong>: add listen/read notes into the feedback box with one click.</li>
              <li><strong>Draft info</strong>: feedback is tagged to the current draft version.</li>
            </ul>
          </Section>

          <Section title="Downloads">
            <ul className="helpBullets">
              <li>Download the EPUB and any other available formats.</li>
              <li>Check “What changed” so you know what to focus on this draft.</li>
            </ul>
          </Section>

          <Section title="Admin (if enabled)">
            <ul className="helpBullets">
              <li>Review feedback, set status, and triage quickly.</li>
              <li>Draft version chips help correlate reports to a manuscript version.</li>
              <li>Prompt coverage chips show which template sections were used.</li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  )
}
