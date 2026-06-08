// =============================================================================
// LMStudioPanel.jsx — LM Studio module: connection settings
// thrive UI — rendered in Settings when the `lmstudio` module is installed+enabled
//
// Settings owns the *connection* only: the host URL + a live reachability check.
// Model selection, the vision tester, and the scoreboard live on the LM Studio
// page (/lmstudio).
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const inp = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }

export default function LMStudioPanel() {
  const [base,      setBase]      = useState('')
  const [baseInput, setBaseInput] = useState('')
  const [online,    setOnline]    = useState(false)
  const [models,    setModels]    = useState([])
  const [probing,   setProbing]   = useState(true)
  const [savingUrl, setSavingUrl] = useState(false)

  const loadStatus = useCallback(async () => {
    setProbing(true)
    try {
      const st = await api.get('/lmstudio/status')
      setBase(st.base || ''); setBaseInput(st.base || '')
      setOnline(!!st.online)
      setModels(Array.isArray(st.models) ? st.models : [])
    } catch { setOnline(false); setModels([]) }
    finally { setProbing(false) }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const saveBase = async () => {
    const v = baseInput.trim()
    if (!v || v === base) return
    setSavingUrl(true)
    try { await api.post('/lmstudio/config', { key: 'base_url', value: v }); await loadStatus() }
    catch {} finally { setSavingUrl(false) }
  }

  const visionCount = models.filter(m => m.vision).length

  return (
    <div style={{ padding: 16 }}>
      <label style={lbl}>Host URL</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={baseInput} onChange={e => setBaseInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveBase()}
          placeholder="http://192.168.0.50:1234" style={inp} />
        <button onClick={saveBase} disabled={savingUrl || !baseInput.trim() || baseInput.trim() === base} style={btnS}>
          {savingUrl ? '…' : 'Save'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: probing ? '#f59e0b' : online ? 'var(--color-success,#22c55e)' : 'var(--color-danger,#ef4444)' }} />
        <span style={{ color: 'var(--text-secondary,#aaa)' }}>
          {probing ? 'Probing…' : online ? `Online — ${models.length} model${models.length === 1 ? '' : 's'}, ${visionCount} vision` : 'Offline — host unreachable'}
        </span>
        {!probing && <button onClick={loadStatus} style={{ ...btnS, padding: '3px 8px', fontSize: 9 }}>↻ Refresh</button>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 8 }}>
        OpenAI-compatible LM Studio server (Developer → Start Server). Pick the default vision
        model and test it on the <strong>LM Studio</strong> page.
      </div>
    </div>
  )
}
