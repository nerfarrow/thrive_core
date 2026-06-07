// =============================================================================
// SettingsPage.jsx — Platform settings (account, modules)
// thrive_core UI — user management lives on its own page (UsersPage / 👥)
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import PlaidPanel from './PlaidPanel'
import EmojiPicker from '../components/EmojiPicker'

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }
const head = { padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const body = { padding: 16 }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 12px' }
const btnP = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }
const inp  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }

function Badge({ kind }) {
  const map = { admin: { bg: 'rgba(168,85,247,0.14)', c: '#a855f7' }, member: { bg: 'rgba(59,130,246,0.12)', c: '#3b82f6' }, disabled: { bg: 'rgba(239,68,68,0.12)', c: '#ef4444' } }
  const s = map[kind] || map.member
  return <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.c, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kind}</span>
}

// Collapsible settings card. Open/closed state is remembered per-title in
// localStorage. `right` header controls only show when expanded.
function CollapsibleCard({ title, right, defaultOpen = true, children }) {
  const key = `settings.open.${title}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(key, n ? '1' : '0') } catch {} return n })
  return (
    <div style={card}>
      <div onClick={toggle}
        style={{ ...head, borderBottom: open ? '1px solid var(--border-color,#2a2a2a)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, display: 'inline-block', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
          {title}
        </span>
        {open && right && <span onClick={e => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  )
}

function ModuleRow({ m, i, saving, editable, onIcon, onColor, children }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', gap: 12, opacity: m.installed ? 1 : 0.7 }}>
      {editable
        ? <EmojiPicker value={m.icon || '📦'} color={m.color} size={34}
            onChange={em => onIcon(m, em)} onColor={c => onColor(m, c)} />
        : <span style={{ fontSize: 20 }}>{m.icon || '📦'}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>v{m.version}</span></div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 2 }}>{m.description}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function GroupHead({ children }) {
  return <div style={{ padding: '8px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', background: 'var(--bg-tertiary,#222)' }}>{children}</div>
}

function ModulesSection() {
  const { user }                = useAuth()
  const isAdmin                 = user?.role === 'admin'
  const [modules,  setModules]  = useState([])
  const [saving,   setSaving]   = useState(null)

  useEffect(() => {
    api.get('/modules').then(setModules).catch(() => {})
  }, [])

  // change a module's icon (admin only); takes effect immediately in nav + landing
  const setIcon = async (m, icon) => {
    try {
      await api.patch(`/modules/${m.id}`, { icon })
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, icon } : x))
      window.dispatchEvent(new CustomEvent('thrivecore:modules-changed'))
    } catch {}
  }

  // change a module's color — preview live in the row; debounce the write +
  // nav refresh so dragging the native colour picker doesn't spam the API.
  const colorTimers = useRef({})
  const setColor = (m, color) => {
    setModules(prev => prev.map(x => x.id === m.id ? { ...x, color } : x))
    clearTimeout(colorTimers.current[m.id])
    colorTimers.current[m.id] = setTimeout(async () => {
      try { await api.patch(`/modules/${m.id}`, { color }); window.dispatchEvent(new CustomEvent('thrivecore:modules-changed')) } catch {}
    }, 300)
  }

  // core modules (e.g. platform infra) aren't shown as installable/toggleable here.
  const visible   = modules.filter(m => !m.core)
  const installed = visible.filter(m => m.installed)
  const available = visible.filter(m => !m.installed)

  const patch = async (m, fields) => {
    setSaving(m.id)
    try {
      await api.patch(`/modules/${m.id}`, fields)
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, ...fields } : x))
      // let the top bar + landing hub refresh their module lists live
      window.dispatchEvent(new CustomEvent('thrivecore:modules-changed'))
    } catch {}
    finally { setSaving(null) }
  }

  const install   = (m) => patch(m, { installed: true,  enabled: true })
  const uninstall = (m) => patch(m, { installed: false, enabled: false })
  const toggle    = (m) => patch(m, { enabled: !m.enabled })

  if (visible.length === 0) return (
    <div style={{ ...body, fontSize: 12, color: 'var(--text-tertiary,#666)', lineHeight: 1.8 }}>
      No modules discovered. Clone a module into <code style={{ fontFamily: 'monospace', fontSize: 11 }}>modules/</code> and restart the API.
    </div>
  )

  const actionBtn = (m, label, color, onClick) => (
    <button onClick={() => onClick(m)} disabled={saving === m.id}
      style={{ ...btnS, padding: '4px 12px', fontSize: 10, opacity: saving === m.id ? 0.5 : 1, color, borderColor: color }}>
      {saving === m.id ? '…' : label}
    </button>
  )

  return (
    <div>
      {installed.length > 0 && <GroupHead>Installed</GroupHead>}
      {installed.map((m, i) => (
        <ModuleRow key={m.id} m={m} i={i} saving={saving} editable={isAdmin} onIcon={setIcon} onColor={setColor}>
          {!m.enabled && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>disabled</span>}
          {actionBtn(m, m.enabled ? 'Disable' : 'Enable',
            m.enabled ? 'var(--color-danger,#ef4444)' : 'var(--color-success,#22c55e)', toggle)}
          {actionBtn(m, 'Uninstall', 'var(--text-tertiary,#888)', uninstall)}
        </ModuleRow>
      ))}

      {available.length > 0 && <GroupHead>Available</GroupHead>}
      {available.map((m, i) => (
        <ModuleRow key={m.id} m={m} i={i} saving={saving} editable={isAdmin} onIcon={setIcon} onColor={setColor}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>not installed</span>
          {actionBtn(m, 'Install', 'var(--color-success,#22c55e)', install)}
        </ModuleRow>
      ))}

      <div style={{ padding: '10px 16px', fontSize: 10, color: 'var(--text-tertiary,#555)', lineHeight: 1.6, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
        Changes take effect after API restart. Add new modules by cloning into <code style={{ fontFamily: 'monospace' }}>modules/</code>.
      </div>
    </div>
  )
}

function AccountsSection() {
  const { user, logout }      = useAuth()
  const [accounts, setAccounts] = useState([])
  const [profiles, setProfiles] = useState([])
  const [adding,   setAdding]   = useState(false)
  const [nu,       setNu]       = useState({ username: '', password: '', role: 'member', user_id: '' })
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [rowUi,    setRowUi]    = useState({})
  const [resetPw,  setResetPw]  = useState({})
  const setRow = (id, patch) => setRowUi(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const load = async () => {
    try {
      const [a, p] = await Promise.all([api.get('/accounts'), api.get('/users').catch(() => [])])
      setAccounts(a); setProfiles(p)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const profileName = (id) => profiles.find(p => p.id === id)?.name

  const add = async () => {
    if (!nu.username || !nu.password) { setErr('Username and password required'); return }
    if (nu.password.length < 8) { setErr('Password must be at least 8 characters'); return }
    setSaving(true); setErr(null)
    try {
      await api.post('/accounts', { ...nu, user_id: nu.user_id ? Number(nu.user_id) : null })
      setNu({ username: '', password: '', role: 'member', user_id: '' }); setAdding(false); load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const changeRole    = async (id, role)     => { try { await api.patch(`/accounts/${id}/role`,     { role });     load() } catch (e) { setErr(e.message) } }
  const toggleDisable = async (id, disabled) => { try { await api.patch(`/accounts/${id}/disabled`, { disabled }); load() } catch (e) { setErr(e.message) } }
  const linkUser      = async (id, user_id)  => { try { await api.patch(`/accounts/${id}/user`,     { user_id: user_id ? Number(user_id) : null }); load() } catch (e) { setErr(e.message) } }
  const doReset       = async (id)           => { const pw = resetPw[id] || ''; if (pw.length < 8) { setErr('Min 8 chars'); return }; try { await api.patch(`/accounts/${id}/password`, { password: pw }); setResetPw(p => ({ ...p, [id]: '' })); setRow(id, { resetting: false }) } catch (e) { setErr(e.message) } }
  const doDelete      = async (id)           => { try { await api.del(`/accounts/${id}`); load() } catch (e) { setErr(e.message) } }

  return (
    <CollapsibleCard title="Accounts"
      right={!adding && <button style={{ ...btnP, padding: '4px 12px', fontSize: 10 }} onClick={() => { setAdding(true); setErr(null) }}>+ Add</button>}>

      {err && <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}

      {adding && (
        <div style={{ padding: 16, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div style={{ marginBottom: 10 }}>
              <div style={lbl}>Username</div>
              <input style={inp} value={nu.username} onChange={e => setNu(p => ({ ...p, username: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={lbl}>Role</div>
              <select style={inp} value={nu.role} onChange={e => setNu(p => ({ ...p, role: e.target.value }))}><option value="member">member</option><option value="admin">admin</option></select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>Temp password (min 8)</div>
              <input style={inp} type="text" value={nu.password} onChange={e => setNu(p => ({ ...p, password: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>Linked user</div>
              <select style={inp} value={nu.user_id} onChange={e => setNu(p => ({ ...p, user_id: e.target.value }))}>
                <option value="">— none —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnS} onClick={() => { setAdding(false); setErr(null) }}>Cancel</button>
            <button style={{ ...btnP, opacity: saving ? 0.5 : 1 }} onClick={add} disabled={saving}>{saving ? 'Adding…' : '✦ Create'}</button>
          </div>
        </div>
      )}

      {accounts.map((a, i) => {
        const ui = rowUi[a.id] || {}
        const isSelf = user && a.id === user.id
        const activeAdmins = accounts.filter(x => x.role === 'admin' && !x.disabled).length
        const isLastAdmin = a.role === 'admin' && !a.disabled && activeAdmins <= 1
        return (
          <div key={a.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isSelf && <span title="signed in" style={{ marginRight: 4 }}>🔑</span>}
                <span style={{ fontSize: 13, fontWeight: 500, marginRight: 8 }}>{a.username}</span>
                <Badge kind={a.role} />
                {a.disabled ? <> <Badge kind="disabled" /></> : null}
                {isSelf && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginLeft: 6 }}>(you)</span>}
                <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>logs in as</span>
                  <select style={{ ...inp, width: 'auto', padding: '3px 6px', fontSize: 11 }} value={a.user_id || ''} onChange={e => linkUser(a.id, e.target.value)}>
                    <option value="">— no profile —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {isSelf && <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={logout}>Sign out</button>}
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: isLastAdmin ? 0.4 : 1, cursor: isLastAdmin ? 'not-allowed' : 'pointer' }}
                  disabled={isLastAdmin} title={isLastAdmin ? "Can't remove the last admin" : ''}
                  onClick={() => changeRole(a.id, a.role === 'admin' ? 'member' : 'admin')}>{a.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: isLastAdmin ? 0.4 : 1, cursor: isLastAdmin ? 'not-allowed' : 'pointer' }}
                  disabled={isLastAdmin} title={isLastAdmin ? "Can't disable the last admin" : ''}
                  onClick={() => toggleDisable(a.id, !a.disabled)}>{a.disabled ? 'Enable' : 'Disable'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { resetting: !ui.resetting })}>Reset pw</button>
                {ui.confirmDelete
                  ? <><button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} onClick={() => doDelete(a.id)}>Confirm</button><button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { confirmDelete: false })}>No</button></>
                  : <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'transparent' }} onClick={() => setRow(a.id, { confirmDelete: true })}>Delete</button>}
              </div>
            </div>
            {ui.resetting && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input style={{ ...inp, flex: 1 }} type="text" placeholder="New password (min 8)" value={resetPw[a.id] || ''} onChange={e => setResetPw(p => ({ ...p, [a.id]: e.target.value }))} autoComplete="off" />
                <button style={{ ...btnP, padding: '7px 12px' }} onClick={() => doReset(a.id)}>Set</button>
                <button style={btnS} onClick={() => setRow(a.id, { resetting: false })}>Cancel</button>
              </div>
            )}
          </div>
        )
      })}
    </CollapsibleCard>
  )
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  // Plaid is a Budget feature — its settings section appears here only when the
  // Budget module is enabled.
  const [budgetEnabled, setBudgetEnabled] = useState(false)
  useEffect(() => {
    api.get('/modules')
      .then(ms => { const b = ms.find(m => m.id === 'budget'); setBudgetEnabled(!!(b && b.installed && b.enabled)) })
      .catch(() => {})
  }, [])

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Settings</h1>
      </div>

      {/* Account: admins manage everything (incl. their own Sign out) in the
          Accounts card below; members get a simple identity + Sign out card. */}
      {user && user.role !== 'admin' && (
        <CollapsibleCard title="Account">
          <div style={{ ...body, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>
              {user.profile?.avatar || '👤'} {user.profile?.name || user.username}
              {' '}<Badge kind={user.role} />
              {user.profile && <span style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', marginLeft: 8, fontFamily: 'monospace' }}>🔑 {user.username}</span>}
            </span>
            <button style={btnS} onClick={logout}>Sign out</button>
          </div>
        </CollapsibleCard>
      )}

      {user?.role === 'admin' && <AccountsSection />}

      <CollapsibleCard title="Modules">
        <ModulesSection />
      </CollapsibleCard>

      {/* Plaid — shown when the Budget module is enabled */}
      {budgetEnabled && (
        <CollapsibleCard title="Plaid">
          <div style={{ padding: 16 }}>
            <PlaidPanel />
          </div>
        </CollapsibleCard>
      )}
    </div>
  )
}
