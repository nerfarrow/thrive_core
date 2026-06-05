// =============================================================================
// SettingsPage.jsx — Platform settings (account, modules)
// thrive_core UI — user management lives on its own page (UsersPage / 👥)
// =============================================================================
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }
const head = { padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const body = { padding: 16 }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 12px' }

function Badge({ kind }) {
  const map = { admin: { bg: 'rgba(168,85,247,0.14)', c: '#a855f7' }, member: { bg: 'rgba(59,130,246,0.12)', c: '#3b82f6' }, disabled: { bg: 'rgba(239,68,68,0.12)', c: '#ef4444' } }
  const s = map[kind] || map.member
  return <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.c, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kind}</span>
}

function ModulesSection() {
  const [modules,  setModules]  = useState([])
  const [saving,   setSaving]   = useState(null)

  useEffect(() => {
    api.get('/modules').then(setModules).catch(() => {})
  }, [])

  // core modules (e.g. users) are platform infrastructure — not shown as
  // installable/toggleable here; they're managed via their own page.
  const visible = modules.filter(m => !m.core)

  const toggle = async (m) => {
    setSaving(m.id)
    try {
      await api.patch(`/modules/${m.id}`, { enabled: !m.enabled })
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, enabled: !x.enabled } : x))
      // let the top bar + landing hub refresh their module lists live
      window.dispatchEvent(new CustomEvent('thrivecore:modules-changed'))
    } catch {}
    finally { setSaving(null) }
  }

  if (visible.length === 0) return (
    <div style={{ ...body, fontSize: 12, color: 'var(--text-tertiary,#666)', lineHeight: 1.8 }}>
      No modules installed. Clone a module into <code style={{ fontFamily: 'monospace', fontSize: 11 }}>modules/</code> and restart the API.
    </div>
  )

  return (
    <div>
      {visible.map((m, i) => (
        <div key={m.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>{m.icon || '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>v{m.version}</span></div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 2 }}>{m.description}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {!m.enabled && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>disabled</span>}
            <button
              onClick={() => toggle(m)}
              disabled={saving === m.id}
              style={{ ...btnS, padding: '4px 12px', fontSize: 10, opacity: saving === m.id ? 0.5 : 1, color: m.enabled ? 'var(--color-danger,#ef4444)' : 'var(--color-success,#22c55e)', borderColor: m.enabled ? 'var(--color-danger,#ef4444)' : 'var(--color-success,#22c55e)' }}>
              {saving === m.id ? '…' : m.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      ))}
      <div style={{ padding: '10px 16px', fontSize: 10, color: 'var(--text-tertiary,#555)', lineHeight: 1.6, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
        Changes take effect after API restart. Install new modules by cloning into <code style={{ fontFamily: 'monospace' }}>modules/</code>.
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { user, logout } = useAuth()

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Settings</h1>
      </div>

      {/* Account */}
      {user && (
        <div style={card}>
          <div style={head}>Account</div>
          <div style={{ ...body, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>👤 {user.username} <Badge kind={user.role} /></span>
            <button style={btnS} onClick={logout}>Sign out</button>
          </div>
        </div>
      )}

      {/* Modules */}
      <div style={card}>
        <div style={head}>Modules</div>
        <ModulesSection />
      </div>
    </div>
  )
}
