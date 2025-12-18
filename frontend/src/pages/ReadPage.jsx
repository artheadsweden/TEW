import TopNav from '../components/TopNav.jsx'
import EpubReader from '../reader/EpubReader.jsx'

export default function ReadPage() {
  return (
    <>
      <TopNav />
      <div className="container page">
        <EpubReader />
      </div>
    </>
  )
}
