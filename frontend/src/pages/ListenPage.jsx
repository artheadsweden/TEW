import TopNav from '../components/TopNav.jsx'
import AudioPlayer from '../player/AudioPlayer.jsx'

export default function ListenPage() {
  return (
    <>
      <TopNav />
      <div className="container page">
        <AudioPlayer />
      </div>
    </>
  )
}
