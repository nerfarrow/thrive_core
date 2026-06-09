// =============================================================================
// LMStudioPage.jsx — LM Studio module page (/lmstudio)
// thrive UI
//
// Dashboard for the local LM Studio host: connection status + editable host URL,
// a browser of every model the host advertises (grouped by type, ● = loaded,
// pick the default vision model), a vision test playground (drop an image + a
// prompt → /lmstudio/vision → parsed JSON + the enhanced crop), and the per-model
// extraction scoreboard. The module also installs a compact panel into Settings.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'

const ACCENT = '#a855f7'   // module color

// Per-model capability badges ("skills"), shown inline next to each model in
// place of the old type-grouped headers. Derived from the model's type + vision
// flag — a VLM does both vision and chat.
const SKILLS = {
  vision: { icon: '👁', label: 'Vision', color: ACCENT },
  chat:   { icon: '💬', label: 'Chat / text', color: '#3b82f6' },
  embed:  { icon: '🔢', label: 'Embeddings', color: '#22c55e' },
}
const skillsOf = (m) => {
  const out = []
  if (m.vision) out.push(SKILLS.vision)
  if (m.type === 'vlm' || m.type === 'llm') out.push(SKILLS.chat)
  if (m.type === 'embeddings') out.push(SKILLS.embed)
  return out
}
// flat-list ordering now that headers are gone: vision/chat first, embeddings, then other
const TYPE_RANK = { vlm: 0, llm: 1, embeddings: 2 }

const DEFAULT_PROMPT =
  'Read all the text and numbers visible in this image. ' +
  'Respond ONLY with a JSON object like {"text": "..."}. No markdown, no explanation.'

// compact token-count formatter: 128000 → "128k", 4096 → "4.1k", 512 → "512"
const fmtK = (n) => n == null ? null : n >= 1000 ? `${+(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `${n}`

const card   = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, overflow: 'hidden' }
const head   = { padding: '10px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const inp    = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl    = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }
const btnS   = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }

export default function LMStudioPage() {
  const { showToast } = useToast()

  const [online,   setOnline]   = useState(false)
  const [models,   setModels]   = useState([])
  const [visModel, setVisModel] = useState('')   // configured default
  const [stats,    setStats]    = useState([])
  const [probing,  setProbing]  = useState(true)

  // vision tester
  const [testModel, setTestModel] = useState('')
  const [imgSrc,    setImgSrc]    = useState(null)
  const [imgB64,    setImgB64]    = useState(null)
  const [imgMime,   setImgMime]   = useState('image/jpeg')
  const [prompt,    setPrompt]    = useState(DEFAULT_PROMPT)
  const [running,   setRunning]   = useState(false)
  const [result,    setResult]    = useState(null)  // { result, enhanced_b64, model }
  const [error,     setError]     = useState(null)
  const [dragging,  setDragging]  = useState(false)
  const fileRef = useRef(null)

  const loadStatus = useCallback(async () => {
    setProbing(true)
    try {
      const st = await api.get('/lmstudio/status')
      setOnline(!!st.online)
      setModels(Array.isArray(st.models) ? st.models : [])
      setVisModel(st.vision_model || '')
      setTestModel(t => t || st.vision_model || '')
    } catch { setOnline(false); setModels([]) }
    finally { setProbing(false) }
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await api.get('/lmstudio/model-stats')) } catch {}
  }, [])

  useEffect(() => { loadStatus(); loadStats() }, [loadStatus, loadStats])

  const pickImage = (file) => {
    if (!file) return
    setImgMime(file.type || 'image/jpeg')
    const reader = new FileReader()
    reader.onload = e => {
      setImgSrc(e.target.result)
      setImgB64(String(e.target.result).split(',')[1])
      setResult(null); setError(null)
    }
    reader.readAsDataURL(file)
  }

  const runTest = async () => {
    if (!imgB64) { showToast('Pick an image first', 'error'); return }
    if (!(testModel || visModel)) { showToast('Pick a vision model first', 'error'); return }
    setRunning(true); setError(null); setResult(null)
    try {
      const data = await api.post('/lmstudio/vision', { b64: imgB64, mime: imgMime, prompt, model: testModel || undefined })
      setResult(data); loadStats()
    } catch (e) { setError(e.message || 'Vision request failed') }
    finally { setRunning(false) }
  }

  const visionModels = models.filter(m => m.vision)
  const statByModel  = Object.fromEntries(stats.map(s => [s.model, s]))

  // flat, sensibly-ordered list (no type headers anymore)
  const sortedModels = [...models].sort((a, b) =>
    (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || a.id.localeCompare(b.id))
  const visionCount = visionModels.length
  const loadedCount = models.filter(m => m.state === 'loaded').length

  return (
    <div style={{ padding: '1.5rem 1.5rem 3rem', maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── header / status ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>🤖 LM Studio</h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 4 }}>Local vision &amp; LLM host</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: probing ? '#f59e0b' : online ? 'var(--color-success,#22c55e)' : 'var(--color-danger,#ef4444)' }} />
          <span style={{ color: 'var(--text-secondary,#aaa)' }}>
            {probing ? 'Probing…' : online ? `Online · ${models.length} models · ${visionCount} vision · ${loadedCount} loaded` : 'Offline — host unreachable'}
          </span>
          <button onClick={() => { loadStatus(); loadStats() }} style={{ ...btnS, padding: '4px 9px', fontSize: 9 }}>↻</button>
        </div>
      </div>

      {/* ── models browser ── */}
      <div style={card}>
        <div style={head}>Models</div>
        <div style={{ padding: models.length ? '4px 0' : 16 }}>
          {models.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)' }}>
              {online ? 'Host is online but advertises no models.' : 'Connect to a host above to list its models.'}
            </div>
          ) : sortedModels.map(m => {
            const isDefault = m.id === visModel
            const s = statByModel[m.id]
            const loaded = m.state === 'loaded'
            // quant · max ctx · (loaded ctx, only while loaded)
            const meta = [
              m.quant,
              m.max_ctx != null && `${fmtK(m.max_ctx)} ctx`,
              loaded && m.loaded_ctx != null && `loaded ${m.loaded_ctx.toLocaleString()}`,
            ].filter(Boolean).join('  ·  ')
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px' }}>
                <span title={loaded ? 'loaded' : 'not loaded'}
                  style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: loaded ? 'var(--color-success,#22c55e)' : 'var(--border-color,#444)' }} />
                {/* skill badges — what this model can do */}
                <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {skillsOf(m).map(sk => (
                    <span key={sk.label} title={sk.label}
                      style={{ fontSize: 11, lineHeight: 1, padding: '3px 5px', borderRadius: 5, background: `${sk.color}22`, cursor: 'help' }}>
                      {sk.icon}
                    </span>
                  ))}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: loaded ? 'var(--text-primary,#e8e6e0)' : 'var(--text-secondary,#aaa)' }} title={m.id}>{m.id}</div>
                  {meta && <div style={{ fontSize: 9, color: loaded ? 'var(--text-secondary,#999)' : 'var(--text-tertiary,#666)', fontFamily: 'monospace', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>}
                </div>
                {s && s.total > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary,#888)', flexShrink: 0 }}>
                    <span style={{ color: 'var(--color-success,#22c55e)' }}>✓{s.success}</span>{' '}
                    <span style={{ color: 'var(--color-danger,#ef4444)' }}>✗{s.fail}</span>
                  </span>
                )}
                {isDefault && (
                  <span title="Default vision model — change in Settings → LM Studio"
                    style={{ flexShrink: 0, padding: '3px 9px', fontSize: 9, borderRadius: 6, fontFamily: 'monospace',
                      textTransform: 'uppercase', letterSpacing: '0.08em', background: ACCENT, color: '#0f0f0f' }}>
                    ✓ default
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── vision tester ── */}
      <div style={card}>
        <div style={head}>Vision test</div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* model override */}
          <div>
            <label style={lbl}>Model {visModel && <span style={{ opacity: 0.6 }}>· default {visModel}</span>}</label>
            {visionModels.length === 0 ? (
              <div style={{ fontSize: 11, color: '#f59e0b' }}>No vision models on the host — load a VLM in LM Studio.</div>
            ) : (
              <select value={testModel} onChange={e => setTestModel(e.target.value)} style={{ ...inp, fontSize: 12 }}>
                <option value="">— use default —</option>
                {visionModels.map(m => <option key={m.id} value={m.id}>{m.id}{m.state === 'loaded' ? ' ●' : ''}</option>)}
              </select>
            )}
          </div>

          {/* image */}
          <div>
            <label style={lbl}>Image</label>
            <div
              onClick={() => !running && fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); if (!running) setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); if (!running && e.dataTransfer.files[0]) pickImage(e.dataTransfer.files[0]) }}
              style={{ border: `1px dashed var(--border-color,${dragging ? '#666' : '#333'})`, borderRadius: 8, padding: 12, textAlign: 'center', cursor: running ? 'wait' : 'pointer', background: dragging ? 'var(--bg-tertiary,#222)' : 'transparent' }}>
              {imgSrc
                ? <img src={imgSrc} alt="" style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 4 }} />
                : <><div style={{ fontSize: 20, opacity: 0.3, marginBottom: 4 }}>🖼️</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary,#aaa)' }}>Drop or click to pick an image</div></>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) pickImage(e.target.files[0]); e.target.value = '' }} />
          </div>

          {/* prompt */}
          <div>
            <label style={lbl}>Prompt</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <button onClick={runTest} disabled={running || !imgB64}
            style={{ alignSelf: 'flex-start', padding: '8px 18px', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: ACCENT, border: 'none', borderRadius: 6, color: '#0f0f0f', fontWeight: 600, cursor: (running || !imgB64) ? 'not-allowed' : 'pointer', opacity: (running || !imgB64) ? 0.5 : 1 }}>
            {running ? 'Running…' : '▶ Run vision'}
          </button>

          {error && <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{error}</div>}

          {result && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <label style={lbl}>Result · {result.model}</label>
                <pre style={{ margin: 0, padding: 12, background: 'var(--bg-tertiary,#1a1a1a)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary,#e8e6e0)', overflow: 'auto', maxHeight: 260 }}>
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </div>
              {result.enhanced_b64 && (
                <div style={{ flexShrink: 0 }}>
                  <label style={lbl}>Enhanced (what the model saw)</label>
                  <img src={`data:image/jpeg;base64,${result.enhanced_b64}`} alt="enhanced"
                    style={{ maxHeight: 180, maxWidth: 220, borderRadius: 8, border: '1px solid var(--border-color,#2a2a2a)', display: 'block', background: '#000' }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── scoreboard ── */}
      {stats.length > 0 && (
        <div style={card}>
          <div style={head}>Extraction scoreboard</div>
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 52px 60px', gap: 6, padding: '6px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)' }}>
              <span>Model</span><span style={{ textAlign: 'right' }}>✓</span><span style={{ textAlign: 'right' }}>✗</span><span style={{ textAlign: 'right' }}>Rate</span>
            </div>
            {stats.map(s => (
              <div key={s.model} style={{ display: 'grid', gridTemplateColumns: '1fr 52px 52px 60px', gap: 6, padding: '6px 16px', fontSize: 11, alignItems: 'center', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
                <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.model}>{s.model}</span>
                <span style={{ textAlign: 'right', color: 'var(--color-success,#22c55e)' }}>{s.success}</span>
                <span style={{ textAlign: 'right', color: 'var(--color-danger,#ef4444)' }}>{s.fail}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary,#aaa)' }}>{s.rate != null ? `${Math.round(s.rate * 100)}%` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
