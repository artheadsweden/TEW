import { Link } from 'react-router-dom'
import TopNav from '../components/TopNav.jsx'
import { useAuth } from '../useAuth.js'

export default function LandingPage() {
  const { authenticated, loading } = useAuth()

  return (
    <>
      <TopNav />
      <div className="landingBackdrop">
        <div className="container landingLayout">
          <div className="card glassCard heroCard">
            <div className="heroGrid">
              <div className="coverFrame">
                <img src="/cover.png" alt="The Enemy Within cover" />
              </div>

              <div>
                <h1 className="heroTitle">The Enemy Within</h1>
                <p className="heroLead">Beta reader portal.</p>

                {!loading && !authenticated ? (
                  <div className="heroActions">
                    <Link className="btn btnPrimary" to="/invite">Create account with invite</Link>
                    <Link className="btn btnSecondary" to="/login">Log in</Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sectionGrid">
            <div className="card glassCard">
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

            <div className="card glassCard">
              <h2 style={{ marginTop: 0 }}>About the author</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Joakim Wassberg writes historically grounded fiction with a bias towards lived detail: the small routines, the local language, the awkward jokes, the practical problems, the private compromises. His work is driven by research, first-hand testimony, and an interest in how ordinary people experience events that later get flattened into headlines.
              </p>
              <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                Alongside fiction, he builds tools and workflows for long-form creative projects, and he is drawn to the overlap between story, memory, and technology: how we record what happened, how we retell it, and how those retellings shape what comes next.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
