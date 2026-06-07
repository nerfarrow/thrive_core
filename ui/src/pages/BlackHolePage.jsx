// =============================================================================
// BlackHolePage.jsx — full-screen interactive black hole + preset manager
// thrive_core UI — reached via the 🕳️ nav icon (/blackhole)
//
// Full-quality interactive view of the shared blackhole-lensing renderer with a
// preset dropdown (library built-ins + user presets from the DB), a few live
// controls, save/delete, "set as background", and a way back to thrive.
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import { BlackHoleRenderer, PRESETS, DEFAULT_PARAMS, DEFAULT_TOGGLES, FEATURES } from 'blackhole-lensing/src/index.js'

const BG_KEY = 'thrivecore:blackhole:bg'   // which preset drives the ambient background (per device)

// library built-ins, surfaced in the dropdown alongside DB presets
const BUILTINS = [
  { key: 'b:artwall',      name: 'Interstellar (built-in)', data: { ...PRESETS.artwall } },
  { key: 'b:thriveSubtle', name: 'Subtle (built-in)',       data: { ...PRESETS.thriveSubtle } },
]

const panel = { background: 'rgba(14,18,24,0.92)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, padding: 14, backdropFilter: 'blur(6px)' }
const btnS  = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }
const btnP  = { ...btnS, background: 'var(--text-primary,#e8e6e0)', color: 'var(--bg-primary,#0f0f0f)', border: 'none', fontWeight: 600 }
const inp   = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '6px 8px', width: '100%', boxSizing: 'border-box' }
const lbl   = { fontSize: 10, color: 'var(--text-tertiary,#666)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }

// full in-app tuner — mirrors the standalone demo's controls
const GROUPS = [
  { t: 'Camera', rows: [
    { k: 'camDist',     label: 'Distance',  min: 8,    max: 40,  step: 0.5 },
    { k: 'inclination', label: 'Tilt',      min: 0,    max: 1.4, step: 0.005 },
    { k: 'fov',         label: 'Zoom',      min: 0.4,  max: 2.5, step: 0.01 },
    { k: 'offsetX',     label: 'Offset X',  min: -0.5, max: 0.5, step: 0.01 },
    { k: 'offsetY',     label: 'Offset Y',  min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { t: 'Black hole / disk', rows: [
    { k: 'horizon',     label: 'Shadow radius', min: 0.4, max: 2.5, step: 0.05 },
    { k: 'diskInner',   label: 'Disk inner',    min: 1.5, max: 8,   step: 0.1 },
    { k: 'diskOuter',   label: 'Disk outer',    min: 5,   max: 20,  step: 0.1 },
  ] },
  { t: 'Look', rows: [
    { k: 'palette',       label: 'Palette',  min: 0, max: 1,   step: 0.01 },
    { k: 'intensity',     label: 'Intensity',min: 0, max: 3,   step: 0.01 },
    { k: 'beaming',       label: 'Beaming',  min: 0, max: 1.5, step: 0.01 },
    { k: 'rotationSpeed', label: 'Rotation', min: 0, max: 4,   step: 0.01 },
  ] },
  { t: 'Atmosphere', rows: [
    { k: 'stars',  label: 'Stars',  min: 0, max: 2, step: 0.01 },
    { k: 'nebula', label: 'Nebula', min: 0, max: 2, step: 0.01 },
    { k: 'glow',   label: 'Bloom',  min: 0, max: 2, step: 0.01 },
  ] },
]
const QUALITIES = ['ultra', 'high', 'medium', 'low', 'potato']

export default function BlackHolePage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const canvasRef = useRef(null)
  const bhRef = useRef(null)
  const [presets, setPresets] = useState([])         // DB presets
  const [sel, setSel] = useState('b:artwall')        // selected dropdown key
  const [qual, setQual] = useState(PRESETS.artwall.quality) // quality preset name
  const [, force] = useState(0)                       // re-render for slider readouts
  const [saveName, setSaveName] = useState('')

  // create the renderer once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bh = new BlackHoleRenderer(canvas, { ...PRESETS.artwall.params }, {
      quality: PRESETS.artwall.quality, respectReducedMotion: false,
      toggles: { ...PRESETS.artwall.toggles },
    })
    bhRef.current = bh
    bh.start()
    const onResize = () => bh.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); bh.destroy(); bhRef.current = null }
  }, [])

  const loadPresets = () => api.get('/blackhole/presets/').then(setPresets).catch(() => {})
  useEffect(() => { loadPresets() }, [])

  // apply a {toggles, params, quality} blob to the live renderer
  const apply = (data) => {
    const bh = bhRef.current
    if (!bh || !data) return
    if (data.params)  bh.setParams({ ...data.params })
    if (data.quality && typeof data.quality === 'string') { bh.setQuality(data.quality); setQual(data.quality) }
    if (data.toggles) bh.setToggles({ ...DEFAULT_TOGGLES, ...data.toggles })
    force(n => n + 1)
  }

  const allOptions = [...BUILTINS, ...presets.map(p => ({ key: `db:${p.id}`, name: p.name, data: p.data, id: p.id }))]
  const current = allOptions.find(o => o.key === sel)

  const onSelect = (key) => {
    setSel(key)
    const opt = allOptions.find(o => o.key === key)
    if (opt) apply(opt.data)
  }

  // current renderer state as a serializable preset blob (quality as a name)
  const snapshot = () => {
    const bh = bhRef.current
    return { toggles: { ...bh.toggles }, params: { ...bh.params }, quality: qual }
  }

  const saveNew = async () => {
    const name = saveName.trim()
    if (!name) { showToast('Enter a preset name', 'error'); return }
    try {
      const saved = await api.post('/blackhole/presets/', { name, data: snapshot() })
      setSaveName('')
      await loadPresets()
      setSel(`db:${saved.id}`)
      showToast(`Saved '${name}'`, 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  const del = async () => {
    if (!current || !current.id) return
    try {
      await api.del(`/blackhole/presets/${current.id}`)
      await loadPresets()
      setSel('b:artwall'); apply(PRESETS.artwall)
      showToast('Deleted', 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  // mark the selected look as the ambient background (per device)
  const setAsBackground = () => {
    try {
      localStorage.setItem(BG_KEY, JSON.stringify(snapshot()))
      window.dispatchEvent(new CustomEvent('thrivecore:blackhole-bg-changed'))
      showToast('Set as background', 'success')
    } catch { showToast('Could not save', 'error') }
  }

  const bh = bhRef.current
  const getParam = (k) => !bh ? 0 : k === 'offsetX' ? bh.params.offset[0] : k === 'offsetY' ? bh.params.offset[1] : bh.params[k]
  const setParam = (k, v) => {
    if (!bh) return
    if (k === 'offsetX') bh.params.offset[0] = v
    else if (k === 'offsetY') bh.params.offset[1] = v
    else bh.setParams({ [k]: v })
    force(n => n + 1)
  }
  const setQuality = (q) => { bh && bh.setQuality(q); setQual(q); force(n => n + 1) }
  const toggleFeat = (f, on) => { bh && bh.setToggles({ [f]: on }); force(n => n + 1) }

  return (
    <div style={{ position: 'fixed', top: 48, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />

      {/* control panel */}
      <div style={{ position: 'absolute', top: 16, right: 16, width: 250, ...panel, maxHeight: 'calc(100% - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary,#888)' }}>Black Hole</span>
          <button style={btnS} onClick={() => navigate('/')}>← thrive</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={lbl}>Preset</div>
          <select style={inp} value={sel} onChange={e => onSelect(e.target.value)}>
            <optgroup label="Built-in">
              {BUILTINS.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
            </optgroup>
            {presets.length > 0 && (
              <optgroup label="Saved">
                {presets.map(p => <option key={p.id} value={`db:${p.id}`}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={{ ...btnS, flex: 1 }} onClick={setAsBackground}>Set as bg</button>
            {current && current.id && <button style={{ ...btnS, color: 'var(--color-danger,#ef4444)' }} onClick={del}>Delete</button>}
          </div>
        </div>

        {bh && (
          <>
            {/* quality */}
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>Quality</div>
              <select style={inp} value={qual} onChange={e => setQuality(e.target.value)}>
                {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>

            {/* feature toggles */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
              {FEATURES.map(f => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'capitalize', cursor: 'pointer' }}>
                  <input type="checkbox" checked={bh.toggles[f]} onChange={e => toggleFeat(f, e.target.checked)} style={{ accentColor: '#8b5cf6' }} /> {f}
                </label>
              ))}
            </div>

            {/* all param sliders, grouped */}
            {GROUPS.map(g => (
              <div key={g.t} style={{ marginBottom: 10 }}>
                <div style={{ ...lbl, color: '#8b5cf6' }}>{g.t}</div>
                {g.rows.map(s => (
                  <div key={s.k} style={{ marginBottom: 8 }}>
                    <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span>{s.label}</span><b style={{ color: 'var(--text-secondary,#aaa)' }}>{(+getParam(s.k)).toFixed(2)}</b>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={getParam(s.k)}
                      onChange={e => setParam(s.k, +e.target.value)} style={{ width: '100%', accentColor: '#8b5cf6' }} />
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        {/* save current as a new preset */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={lbl}>Save current as…</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={inp} placeholder="preset name" value={saveName}
              onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNew()} />
            <button style={btnP} onClick={saveNew}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
