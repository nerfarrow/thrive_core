// =============================================================================
// SettingsPage.jsx — Platform settings (users, account, theme)
// thrive_base UI
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }
const head = { padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const body = { padding: 16 }
const inp  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnP = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }
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

  const toggle = async (m) => {
    setSaving(m.id)
    try {
      await api.patch(`/modules/${m.id}`, { enabled: !m.enabled })
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, enabled: !x.enabled } : x))
    } catch {}
    finally { setSaving(null) }
  }

  if (modules.length === 0) return (
    <div style={{ ...body, fontSize: 12, color: 'var(--text-tertiary,#666)', lineHeight: 1.8 }}>
      No modules installed. Clone a module into <code style={{ fontFamily: 'monospace', fontSize: 11 }}>modules/</code> and restart the API.
    </div>
  )

  return (
    <div>
      {modules.map((m, i) => (
        <div key={m.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>{m.icon || '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>v{m.version}</span></div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 2 }}>{m.description}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {m.core ? (
              <span title="Required by the platform — can't be disabled" style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>🔒 core</span>
            ) : (
              <>
                {!m.enabled && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>disabled</span>}
                <button
                  onClick={() => toggle(m)}
                  disabled={saving === m.id}
                  style={{ ...btnS, padding: '4px 12px', fontSize: 10, opacity: saving === m.id ? 0.5 : 1, color: m.enabled ? 'var(--color-danger,#ef4444)' : 'var(--color-success,#22c55e)', borderColor: m.enabled ? 'var(--color-danger,#ef4444)' : 'var(--color-success,#22c55e)' }}>
                  {saving === m.id ? '…' : m.enabled ? 'Disable' : 'Enable'}
                </button>
              </>
            )}
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
  const [users,   setUsers]   = useState([])
  const [adding,  setAdding]  = useState(false)
  const [nu,      setNu]      = useState({ username: '', password: '', role: 'member' })
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState(null)
  const [rowUi,   setRowUi]   = useState({})
  const [resetPw, setResetPw] = useState({})
  const setRow = (id, patch) => setRowUi(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const load = useCallback(async () => {
    if (user?.role !== 'admin') return
    try { setUsers(await api.get('/auth/users')) } catch {}
  }, [user])
  useEffect(() => { load() }, [load])

  const addUser = async () => {
    if (!nu.username || !nu.password) { setErr('Username and password required'); return }
    if (nu.password.length < 8) { setErr('Password must be at least 8 characters'); return }
    setSaving(true); setErr(null)
    try { await api.post('/auth/register', nu); setNu({ username: '', password: '', role: 'member' }); setAdding(false); load() }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }
  const changeRole    = async (id, role)     => { try { await api.patch(`/auth/users/${id}/role`,     { role });     load() } catch (e) { setErr(e.message) } }
  const toggleDisable = async (id, disabled) => { try { await api.patch(`/auth/users/${id}/disabled`, { disabled }); load() } catch (e) { setErr(e.message) } }
  const doReset       = async (id)           => { const pw = resetPw[id] || ''; if (pw.length < 8) { setErr('Min 8 chars'); return }; try { await api.patch(`/auth/users/${id}/password`, { password: pw }); setResetPw(p => ({ ...p, [id]: '' })); setRow(id, { resetting: false }) } catch (e) { setErr(e.message) } }
  const doDelete      = async (id)           => { try { await api.del(`/auth/users/${id}`); load() } catch (e) { setErr(e.message) } }

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

      {/* Users — admin only */}
      {user?.role === 'admin' && (
        <div style={card}>
          <div style={{ ...head, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Users</span>
            {!adding && <button style={{ ...btnP, padding: '4px 12px', fontSize: 10 }} onClick={() => { setAdding(true); setErr(null) }}>+ Add</button>}
          </div>
          {err && <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}
          {adding && (
            <div style={{ padding: 16, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Username</div>
                  <input style={inp} value={nu.username} onChange={e => setNu(p => ({ ...p, username: e.target.value }))} autoComplete="off" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Role</div>
                  <select style={inp} value={nu.role} onChange={e => setNu(p => ({ ...p, role: e.target.value }))}><option value="member">member</option><option value="admin">admin</option></select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Temp password (min 8)</div>
                <input style={inp} type="text" value={nu.password} onChange={e => setNu(p => ({ ...p, password: e.target.value }))} autoComplete="off" />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btnS} onClick={() => { setAdding(false); setErr(null) }}>Cancel</button>
                <button style={{ ...btnP, opacity: saving ? 0.5 : 1 }} onClick={addUser} disabled={saving}>{saving ? 'Adding…' : '✦ Create'}</button>
              </div>
            </div>
          )}
          {users.map((u, i) => {
            const ui = rowUi[u.id] || {}
            const isSelf = user && u.id === user.id
            return (
              <div key={u.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, marginRight: 8 }}>{u.username}</span>
                    <Badge kind={u.role} />
                    {u.disabled && <> <Badge kind="disabled" /></>}
                    {isSelf && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginLeft: 6 }}>(you)</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => changeRole(u.id, u.role === 'admin' ? 'member' : 'admin')}>{u.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                    <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => toggleDisable(u.id, !u.disabled)}>{u.disabled ? 'Enable' : 'Disable'}</button>
                    <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(u.id, { resetting: !ui.resetting })}>Reset pw</button>
                    {ui.confirmDelete
                      ? <><button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} onClick={() => doDelete(u.id)}>Confirm</button><button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(u.id, { confirmDelete: false })}>No</button></>
                      : <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'transparent' }} onClick={() => setRow(u.id, { confirmDelete: true })}>Delete</button>}
                  </div>
                </div>
                {ui.resetting && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input style={{ ...inp, flex: 1 }} type="text" placeholder="New password (min 8)" value={resetPw[u.id] || ''} onChange={e => setResetPw(p => ({ ...p, [u.id]: e.target.value }))} autoComplete="off" />
                    <button style={{ ...btnP, padding: '7px 12px' }} onClick={() => doReset(u.id)}>Set</button>
                    <button style={btnS} onClick={() => setRow(u.id, { resetting: false })}>Cancel</button>
                  </div>
                )}
              </div>
            )
          })}
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