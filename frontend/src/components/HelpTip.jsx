export default function HelpTip({ text }) {
  const t = String(text || '').trim()
  if (!t) return null

  return (
    <span className="helpTip">
      <span className="helpTipBtn" aria-hidden="true">?</span>
      <span className="helpTipBubble" role="tooltip">{t}</span>
    </span>
  )
}
