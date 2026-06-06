// =============================================================================
// App.jsx — thrive_core shell
// Minimal: auth gate, top nav, landing, settings
// =============================================================================
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { api } from './api'
import LoginPage   from './components/LoginPage'
import LandingPage from './pages/LandingPage'
import SettingsPage from './pages/SettingsPage'
import UsersPage   from './pages/UsersPage'
import HomePage    from './pages/HomePage'
import VehiclesPage from './pages/VehiclesPage'

// ── top nav ───────────────────────────────────────────────────────────────────
// Custom nav icon order is persisted per-device (localStorage) — the icon
// arrangement is a property of this screen/kiosk, not the account.
const NAV_ORDER_KEY = 'thrivecore:navOrder'
const loadNavOrder = () => { try { return JSON.parse(localStorage.getItem(NAV_ORDER_KEY)) || [] } catch { return [] } }

function TopNav() {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [hov, setHov] = useState(null)
  const [modules, setModules] = useState([])
  const [order,  setOrder]  = useState(loadNavOrder)   // array of module ids
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  useEffect(() => {
    if (!user) { setModules([]); return }
    const fetchModules = () => api.get('/modules').then(setModules).catch(() => {})
    fetchModules()
    window.addEventListener('thrivecore:modules-changed', fetchModules)
    return () => window.removeEventListener('thrivecore:modules-changed', fetchModules)
  }, [user])

  // active nav modules, arranged by the saved order; unknown/new ones fall to the end
  const active = modules.filter(m => m.installed && m.enabled && m.nav_path)
  const byId   = new Map(active.map(m => [m.id, m]))
  const navModules = [
    ...order.filter(id => byId.has(id)).map(id => byId.get(id)),
    ...active.filter(m => !order.includes(m.id)),
  ]

  const persistOrder = (ids) => {
    setOrder(ids)
    try { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(ids)) } catch {}
  }
  const dropOn = (targetId) => {
    if (dragId && dragId !== targetId) {
      const ids = navModules.map(m => m.id)
      ids.splice(ids.indexOf(dragId), 1)            // pull the dragged id out
      ids.splice(ids.indexOf(targetId), 0, dragId)  // drop it in front of the target
      persistOrder(ids)
    }
    setDragId(null); setOverId(null)
  }

  const path = location.pathname
  const iconBtn = (id) => ({
    width: 36, height: 36, borderRadius: 8,
    background: path.startsWith(`/${id}`) || (id === 'home' && path === '/') ? 'var(--bg-tertiary,#2a2a2a)' : hov === id ? 'var(--bg-tertiary,#222)' : 'none',
    border: 'none', cursor: 'pointer', fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: path.startsWith(`/${id}`) || (id === 'home' && path === '/') ? 1 : hov === id ? 0.85 : 0.5,
    transition: 'opacity 0.12s, background 0.12s',
  })

  if (!user) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 48, zIndex: 200, background: 'var(--bg-secondary,#181818)', borderBottom: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 2 }}>
      <button onClick={() => navigate('/')} style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', background: 'none', border: 'none', color: 'var(--text-primary,#e8e6e0)', cursor: 'pointer', padding: '0 10px 0 4px', marginRight: 4, opacity: 0.9 }}>
        thrive
      </button>
      <div style={{ width: 1, height: 20, background: 'var(--border-color,#333)', marginRight: 6 }} />

      {/* module icons — dynamic + drag-to-reorder (order saved per device) */}
      {navModules.map(m => {
        const isOver = overId === m.id && dragId && dragId !== m.id
        return (
          <button key={m.id} onClick={() => navigate(m.nav_path)} title={m.name}
            draggable
            onDragStart={e => { setDragId(m.id); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnter={() => setOverId(m.id)}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={e => { e.preventDefault(); dropOn(m.id) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
            style={{
              ...iconBtn(m.id),
              cursor: 'grab',
              opacity: dragId === m.id ? 0.3 : iconBtn(m.id).opacity,
              boxShadow: isOver ? 'inset 2px 0 0 var(--text-primary,#e8e6e0)' : 'none',
            }}
            onMouseEnter={() => setHov(m.id)}
            onMouseLeave={() => setHov(null)}>
            {m.icon || '📦'}
          </button>
        )
      })}

      <div style={{ flex: 1 }} />
      <button onClick={() => navigate('/settings')} title="Settings"
        style={iconBtn('settings')}
        onMouseEnter={() => setHov('settings')}
        onMouseLeave={() => setHov(null)}>
        ⚙️
      </button>
    </div>
  )
}

// ── root ────────────────────────────────────────────────────────────────────
// Landing behaviour depends on the home module: if it's active, `/` is the home
// base; otherwise `/` shows the module tiles (LandingPage).
function RootRoute() {
  const [dest, setDest] = useState(undefined)   // undefined=loading | string nav_path | null=tiles
  useEffect(() => {
    let cancelled = false
    api.get('/modules')
      .then(ms => {
        const home = ms.find(m => m.id === 'home' && m.installed && m.enabled)
        if (!cancelled) setDest(home ? (home.nav_path || '/home') : null)
      })
      .catch(() => { if (!cancelled) setDest(null) })
    return () => { cancelled = true }
  }, [])
  if (dest === undefined) return null            // brief: avoid flashing tiles before redirect
  if (dest) return <Navigate to={dest} replace />
  return <LandingPage />
}

// ── shell ─────────────────────────────────────────────────────────────────────
function Shell() {
  return (
    <>
      <TopNav />
      <main style={{ marginTop: 48, minHeight: 'calc(100vh - 48px)' }}>
        <Routes>
          <Route path="/"         element={<RootRoute />} />
          <Route path="/home"     element={<HomePage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/users"    element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}

// ── gate ──────────────────────────────────────────────────────────────────────
function Gate() {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary,#888)', fontFamily: 'monospace', fontSize: 13 }}>
      Loading…
    </div>
  )
  if (!user) return <LoginPage />
  return <Shell />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}