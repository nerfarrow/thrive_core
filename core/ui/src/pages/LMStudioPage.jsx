// =============================================================================
// LMStudioPage.jsx — LM Studio module page (/lmstudio)
// thrive UI
//
// Dashboard for the local LM Studio host: connection status + editable host URL,
// a sortable table of every model the host advertises (skills, quant, run
// counts; ● = loaded, with its loaded context shown under the name), a vision
// test playground (drop an image + a prompt →
// /lmstudio/vision → parsed JSON + the enhanced crop), and the per-model
// extraction scoreboard. The module also installs a compact panel into Settings.
// =============================================================================
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'

const ACCENT = '#a855f7'   // module color

// Per-model capability badges ("skills"). Derived from the model's type plus
// LM Studio's `capabilities` array — known capabilities get their own icon,
// anything new falls back to a generic badge so every capability the host
// reports is visible. No badge for plain chat: that a model can chat is a given.
const SKILLS = {
  vision:   { icon: '👁', label: 'Vision', color: ACCENT },
  embed:    { icon: '🔢', label: 'Embeddings', color: '#22c55e' },
  tool_use: { icon: '🔧', label: 'Tool use', color: '#f59e0b' },
}
const skillsOf = (m) => {
  const caps = m.capabilities || []
  const out = []
  if (m.vision || caps.includes('vision')) out.push(SKILLS.vision)
  if (m.type === 'embedding') out.push(SKILLS.embed)
  for (const c of caps) {
    if (c === 'vision') continue   // already badged above
    out.push(SKILLS[c] || { icon: '✨', label: c.replace(/_/g, ' '), color: '#888' })
  }
  return out
}
// default table ordering: vision models first, then chat, then embeddings
const typeRank = (m) => m.vision ? 0 : m.type === 'llm' ? 1 : m.type === 'embedding' ? 2 : 9

// numeric ordering for quant strings: "Q4_K_M" → 4, "8bit" → 8; null when unknown
const quantNum = (q) => { const m = /(\d+(?:\.\d+)?)/.exec(q || ''); return m ? +m[1] : null }

// numeric ordering for params strings: "270M" → 2.7e8, "12B" → 1.2e10; null when unknown
const paramsNum = (p) => {
  const m = /^([\d.]+)\s*([kmb]?)/i.exec(p || '')
  return m ? +m[1] * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1) : null
}

// model-table column layout, shared by the header row and every body row
// (last col is the load/unload action button)
const MODEL_COLS = '14px 56px minmax(0,1fr) 58px 118px 74px 60px 30px'

// ── load-config form ──────────────────────────────────────────────────────────
// blank '' (or gpu_auto) means "leave at the host default". Booleans are tri-state
// selects ('' | 'on' | 'off') so "default" stays distinct from an explicit false.
const blankCfg = (m) => ({
  context_length: m.max_ctx ? String(m.max_ctx) : '',
  gpu_auto: true, gpu_ratio: 100,           // GPU offload: auto, or a 0–100% layer ratio
  flash_attention: '', offload_kv_cache_to_gpu: '', keep_model_in_memory: '',
  gpu_strict_vram_cap: '', use_fp16_for_kv_cache: '', try_mmap: '',
  eval_batch_size: '', num_experts: '', seed: '',
  rope_frequency_base: '', rope_frequency_scale: '', kv_quant: '',
})

// quant options for the K/V cache (one control drives both K and V — they're set
// together in practice). Smaller = less memory at long context, slightly lossy.
const KV_QUANTS = ['f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0']

// fold the form into the SDK's snake_case config dict, dropping anything at default
const buildConfig = (c) => {
  const out = {}
  const int = (k, v) => { const n = parseInt(v);   if (Number.isFinite(n)) out[k] = n }
  const flt = (k, v) => { const n = parseFloat(v); if (Number.isFinite(n)) out[k] = n }
  const bool = (k) => { if (c[k] === 'on') out[k] = true; else if (c[k] === 'off') out[k] = false }
  if (c.context_length) int('context_length', c.context_length)
  if (!c.gpu_auto) out.gpu = { ratio: Math.max(0, Math.min(100, parseInt(c.gpu_ratio) || 0)) / 100 }
  bool('flash_attention'); bool('offload_kv_cache_to_gpu'); bool('keep_model_in_memory')
  bool('gpu_strict_vram_cap'); bool('use_fp16_for_kv_cache'); bool('try_mmap')
  if (c.eval_batch_size) int('eval_batch_size', c.eval_batch_size)
  if (c.num_experts)     int('num_experts', c.num_experts)
  if (c.seed)            int('seed', c.seed)
  if (c.rope_frequency_base)  flt('rope_frequency_base', c.rope_frequency_base)
  if (c.rope_frequency_scale) flt('rope_frequency_scale', c.rope_frequency_scale)
  if (c.kv_quant) { out.llama_k_cache_quantization_type = c.kv_quant; out.llama_v_cache_quantization_type = c.kv_quant }
  return out
}

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
  const [busy,     setBusy]     = useState({})   // model id → true while (un)loading on the host
  const [cfgFor,   setCfgFor]   = useState(null) // model id whose load-config strip is open
  const [cfg,      setCfg]      = useState({})   // load-config form values for that strip
  const [cfgAdv,   setCfgAdv]   = useState(false)// advanced section expanded?
  const [sort,     setSort]     = useState({ key: 'type', dir: 1 })   // model-table sort

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

  // open the load-config strip under a model, seeding the form from its defaults
  const openCfg = (m) => { setCfg(blankCfg(m)); setCfgAdv(false); setCfgFor(m.id) }
  const up = (k, v) => setCfg(c => ({ ...c, [k]: v }))   // patch one form field

  // load/unload a model on the host. Blocks for the host round-trip (a big model
  // can take a while to load), then re-probes so the ● dot + loaded-ctx refresh.
  // On load, the open strip's form becomes the SDK config; unload needs no config.
  const perform = async (m, loaded) => {
    const label = m.name || m.id
    const config = loaded ? null : buildConfig(cfg)
    setCfgFor(null)
    setBusy(b => ({ ...b, [m.id]: true }))
    if (!loaded) showToast(`Loading ${label}…`, 'info')
    try {
      const body = loaded ? { model: m.id, type: m.type } : { model: m.id, type: m.type, config }
      await api.post(loaded ? '/lmstudio/unload' : '/lmstudio/load', body)
      showToast(loaded ? `Unloaded ${label}` : `Loaded ${label}`, 'success')
      await loadStatus()
    } catch (e) {
      showToast(e.message || 'Request failed', 'error')
    } finally {
      setBusy(b => { const n = { ...b }; delete n[m.id]; return n })
    }
  }

  // compact renderers for the advanced load-config fields. Plain functions (not
  // components) so React keeps each input's focus across keystrokes.
  const fieldCol = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }
  const miniLbl  = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-tertiary,#666)' }
  const miniInp  = { ...inp, padding: '4px 7px', fontSize: 11 }
  const boolSel = (k, label) => (
    <label key={k} style={fieldCol}>
      <span style={miniLbl}>{label}</span>
      <select value={cfg[k] ?? ''} onChange={e => up(k, e.target.value)} style={miniInp}>
        <option value="">default</option><option value="on">on</option><option value="off">off</option>
      </select>
    </label>
  )
  const numFld = (k, label, ph, step) => (
    <label key={k} style={fieldCol}>
      <span style={miniLbl}>{label}</span>
      <input type="number" value={cfg[k] ?? ''} step={step} placeholder={ph || ''}
        onChange={e => up(k, e.target.value)} style={miniInp} />
    </label>
  )

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

  // sortable model table: click a header to sort by it, again to flip direction
  const sortVal = {
    type:   typeRank,
    id:     m => (m.name || m.id).toLowerCase(),
    params: m => paramsNum(m.params),
    pub:    m => m.publisher?.toLowerCase(),
    quant:  m => quantNum(m.quant),
    runs:   m => statByModel[m.id]?.total ?? 0,
  }[sort.key]
  const sortedModels = [...models].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b)
    let d
    if (va == null || vb == null) d = (va == null) - (vb == null)   // missing values sink, either direction
    else d = (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sort.dir
    return d || a.id.localeCompare(b.id)
  })
  const onSort = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }))
  const Th = ({ k, label, align }) => (
    <button onClick={() => onSort(k)} title={`Sort by ${label.toLowerCase()}`}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: align || 'left',
        color: sort.key === k ? 'var(--text-secondary,#aaa)' : 'var(--text-tertiary,#666)' }}>
      {label}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  )
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
          ) : (
            <>
              {/* header row — click a column to sort */}
              <div style={{ display: 'grid', gridTemplateColumns: MODEL_COLS, gap: 8, alignItems: 'center', padding: '6px 16px' }}>
                <span />
                <Th k="type"  label="Skills" />
                <Th k="id"     label="Model" />
                <Th k="params" label="Params" />
                <Th k="pub"    label="Publisher" />
                <Th k="quant"  label="Quant" />
                <Th k="runs"  label="Runs" align="right" />
                <span />
              </div>
              {sortedModels.map(m => {
                const isDefault = m.id === visModel
                const s = statByModel[m.id]
                const loaded = m.state === 'loaded'
                const cfgOpen = cfgFor === m.id
                return (
                 <Fragment key={m.id}>
                  <div style={{ display: 'grid', gridTemplateColumns: MODEL_COLS, gap: 8, alignItems: 'center', padding: '6px 16px', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
                    <span title={loaded ? 'loaded' : 'not loaded'}
                      style={{ width: 7, height: 7, borderRadius: '50%', background: loaded ? 'var(--color-success,#22c55e)' : 'var(--border-color,#444)' }} />
                    {/* skill badges — what this model can do */}
                    <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {skillsOf(m).map(sk => (
                        <span key={sk.label} title={sk.label}
                          style={{ fontSize: 11, lineHeight: 1, padding: '3px 5px', borderRadius: 5, background: `${sk.color}22`, cursor: 'help' }}>
                          {sk.icon}
                        </span>
                      ))}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: loaded ? 'var(--text-primary,#e8e6e0)' : 'var(--text-secondary,#aaa)' }} title={m.id}>{m.name || m.id}</span>
                        {isDefault && (
                          <span title="Default vision model — change in Settings → LM Studio"
                            style={{ flexShrink: 0, padding: '2px 7px', fontSize: 9, borderRadius: 6, fontFamily: 'monospace',
                              textTransform: 'uppercase', letterSpacing: '0.08em', background: ACCENT, color: '#0f0f0f' }}>
                            ✓ default
                          </span>
                        )}
                      </div>
                      {/* loaded models report the context window they were spun up with */}
                      {loaded && m.loaded_ctx != null && (
                        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)', marginTop: 2 }}
                          title={`loaded with ${m.loaded_ctx.toLocaleString()} ctx`}>
                          ▸ {fmtK(m.loaded_ctx)} ctx
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary,#999)', whiteSpace: 'nowrap' }}>
                      {m.params || '—'}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary,#999)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.publisher || undefined}>
                      {m.publisher || '—'}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary,#999)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.quant || undefined}>
                      {m.quant || '—'}
                    </span>
                    <span style={{ fontSize: 10, textAlign: 'right', color: 'var(--text-tertiary,#888)' }}>
                      {s && s.total > 0 ? (
                        <>
                          <span style={{ color: 'var(--color-success,#22c55e)' }}>✓{s.success}</span>{' '}
                          <span style={{ color: 'var(--color-danger,#ef4444)' }}>✗{s.fail}</span>
                        </>
                      ) : '—'}
                    </span>
                    {/* load (opens a context strip) / unload (one click) on the host */}
                    <button onClick={() => loaded ? perform(m, true) : (cfgOpen ? setCfgFor(null) : openCfg(m))}
                      disabled={!online || !!busy[m.id]}
                      title={busy[m.id] ? 'Working…' : loaded ? 'Unload from host' : 'Load on host'}
                      style={{ justifySelf: 'center', width: 24, height: 24, padding: 0, lineHeight: 1, borderRadius: 6,
                        fontSize: 11, fontFamily: 'monospace', cursor: (!online || busy[m.id]) ? 'default' : 'pointer',
                        background: loaded ? 'rgba(34,197,94,0.12)' : cfgOpen ? `${ACCENT}22` : 'var(--bg-tertiary,#222)',
                        border: `1px solid ${loaded ? 'rgba(34,197,94,0.45)' : cfgOpen ? ACCENT : 'var(--border-color,#333)'}`,
                        color: loaded ? 'var(--color-success,#22c55e)' : cfgOpen ? ACCENT : 'var(--text-secondary,#aaa)',
                        opacity: (!online || busy[m.id]) ? 0.5 : 1 }}>
                      {busy[m.id] ? '◐' : loaded ? '⏏' : cfgOpen ? '×' : '▶'}
                    </button>
                  </div>

                  {/* load-config strip: context + GPU up front, the rest under Advanced */}
                  {cfgOpen && (
                    <div style={{ padding: '10px 16px 14px 38px', borderTop: '1px dashed var(--border-color,#2a2a2a)',
                      background: 'var(--bg-tertiary,#1a1a1a)', display: 'flex', flexDirection: 'column', gap: 11 }}>

                      {/* primary row: context length + GPU offload + actions */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
                        <label style={fieldCol}>
                          <span style={miniLbl}>Context length</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="number" min="1024" step="1024" value={cfg.context_length} placeholder="model default"
                              onChange={e => up('context_length', e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') perform(m, false) }}
                              style={{ ...miniInp, width: 120, fontSize: 12 }} />
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>
                              {m.max_ctx ? `max ${fmtK(m.max_ctx)}` : 'blank = default'}
                            </span>
                          </div>
                        </label>

                        <label style={fieldCol}>
                          <span style={miniLbl}>GPU offload</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary,#aaa)', cursor: 'pointer' }}>
                              <input type="checkbox" checked={cfg.gpu_auto} onChange={e => up('gpu_auto', e.target.checked)} /> auto
                            </label>
                            {!cfg.gpu_auto && (
                              <>
                                <input type="range" min="0" max="100" step="5" value={cfg.gpu_ratio}
                                  onChange={e => up('gpu_ratio', e.target.value)} style={{ width: 120, accentColor: ACCENT }} />
                                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary,#aaa)', width: 34, textAlign: 'right' }}>{cfg.gpu_ratio}%</span>
                              </>
                            )}
                          </div>
                        </label>

                        <div style={{ flex: 1 }} />
                        <button onClick={() => perform(m, false)} disabled={!!busy[m.id]}
                          style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                            background: ACCENT, border: 'none', borderRadius: 6, color: '#0f0f0f', fontWeight: 600, cursor: 'pointer' }}>Load</button>
                        <button onClick={() => setCfgFor(null)} style={{ ...btnS, padding: '6px 12px', fontSize: 10 }}>Cancel</button>
                      </div>

                      {/* advanced — everything else the SDK accepts at load time */}
                      <button onClick={() => setCfgAdv(a => !a)}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#888)' }}>
                        {cfgAdv ? '▾' : '▸'} Advanced
                      </button>
                      {cfgAdv && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: '10px 14px' }}>
                          {boolSel('flash_attention', 'Flash attention')}
                          {boolSel('offload_kv_cache_to_gpu', 'KV cache on GPU')}
                          {boolSel('keep_model_in_memory', 'Keep in memory')}
                          {boolSel('gpu_strict_vram_cap', 'Strict VRAM cap')}
                          <label style={fieldCol}>
                            <span style={miniLbl}>KV cache quant</span>
                            <select value={cfg.kv_quant} onChange={e => up('kv_quant', e.target.value)} style={miniInp}>
                              <option value="">default</option>
                              {KV_QUANTS.map(q => <option key={q} value={q}>{q}</option>)}
                            </select>
                          </label>
                          {boolSel('use_fp16_for_kv_cache', 'fp16 KV cache')}
                          {boolSel('try_mmap', 'mmap file')}
                          {numFld('eval_batch_size', 'Eval batch', 'auto', 1)}
                          {numFld('num_experts', 'MoE experts', 'auto', 1)}
                          {numFld('seed', 'Seed', 'random', 1)}
                          {numFld('rope_frequency_base', 'RoPE base', 'auto', 1000)}
                          {numFld('rope_frequency_scale', 'RoPE scale', 'auto', 0.1)}
                        </div>
                      )}
                    </div>
                  )}
                 </Fragment>
                )
              })}
            </>
          )}
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
