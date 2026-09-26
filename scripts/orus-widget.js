// Orus lock screen widget, for the Scriptable app (free, App Store).
//
// Setup
//   1. In Orus: Settings → Lock screen widget → Copy link.
//   2. Open Scriptable → + → paste this whole file.
//   3. Replace ORUS_URL below with the link you copied. Name the script "Orus".
//   4. Long-press the lock screen → Customise → add a Scriptable widget →
//      choose this script. Circular, inline and rectangular all work.
//
// The widget shows your heart rate: the ring's latest reading when it is
// recent, and your resting rate underneath. iOS refreshes lock screen widgets
// every few minutes at its own pace, so treat the number as recent, not live.
// The last reading is cached, so a dropped connection shows the old number
// greyed rather than an empty widget.

const ORUS_URL = 'PASTE_YOUR_LINK_HERE'

const CACHE = FileManager.local().joinPath(FileManager.local().cacheDirectory(), 'orus-widget.json')

async function load() {
  try {
    const res = await new Request(ORUS_URL).loadJSON()
    if (res && !res.error) {
      FileManager.local().writeString(CACHE, JSON.stringify({ ...res, cachedAt: Date.now() }))
      return { data: res, stale: false }
    }
  } catch (e) {
    // fall through to the cache
  }
  if (FileManager.local().fileExists(CACHE)) {
    try {
      return { data: JSON.parse(FileManager.local().readString(CACHE)), stale: true }
    } catch (e) { /* cache unreadable */ }
  }
  return { data: null, stale: true }
}

/** "3m" / "2h" / "4d" — how old a reading is. */
function ago(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const { data, stale } = await load()
const hr = data?.hr ?? null
const resting = data?.restingHr ?? null
// A reading older than 15 minutes is history, not a pulse.
const fresh = data?.hrAt ? Date.now() - new Date(data.hrAt).getTime() < 15 * 60000 : false
const white = new Color('#F5F5F4')
const dim = new Color('#F5F5F4', stale || !fresh ? 0.55 : 0.8)

const widget = new ListWidget()
widget.backgroundColor = new Color('#050505')
widget.url = 'orus://'
widget.refreshAfterDate = new Date(Date.now() + 10 * 60000)

const family = config.widgetFamily || 'accessoryRectangular'

if (family === 'accessoryCircular') {
  const stack = widget.addStack()
  stack.layoutVertically()
  stack.centerAlignContent()
  const heart = stack.addText('♥')
  heart.font = Font.systemFont(11)
  heart.textColor = dim
  heart.centerAlignText()
  const value = stack.addText(hr != null ? String(hr) : resting != null ? String(resting) : '—')
  value.font = Font.semiboldRoundedSystemFont(20)
  value.textColor = white
  value.centerAlignText()
  const label = stack.addText(fresh ? 'bpm' : resting != null && hr == null ? 'rest' : ago(data?.hrAt) || '—')
  label.font = Font.systemFont(9)
  label.textColor = dim
  label.centerAlignText()
} else if (family === 'accessoryInline') {
  const parts = []
  if (hr != null) parts.push(`♥ ${hr}${fresh ? '' : ` (${ago(data.hrAt)})`}`)
  if (resting != null) parts.push(`rest ${resting}`)
  widget.addText(parts.join(' · ') || 'Orus: no data')
} else {
  // Rectangular (lock screen) and small (home screen)
  const title = widget.addText(data?.name ? `ORUS · ${data.name.toUpperCase()}` : 'ORUS')
  title.font = Font.mediumSystemFont(9)
  title.textColor = new Color('#F5F5F4', 0.5)
  widget.addSpacer(4)

  const row = widget.addStack()
  row.centerAlignContent()
  const big = row.addText(hr != null ? String(hr) : '—')
  big.font = Font.semiboldRoundedSystemFont(28)
  big.textColor = white
  row.addSpacer(4)
  const unit = row.addText('bpm')
  unit.font = Font.systemFont(11)
  unit.textColor = dim
  row.addSpacer()

  widget.addSpacer(2)
  const foot = widget.addText(
    [resting != null ? `rest ${resting}` : null, hr != null ? (fresh ? 'live' : `${ago(data.hrAt)} ago`) : 'no reading yet']
      .filter(Boolean).join(' · '),
  )
  foot.font = Font.systemFont(10)
  foot.textColor = dim
}

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentAccessoryRectangular()
}
Script.complete()
