// =============================================================================
// App.jsx — thrive_base shell
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

// ── top nav ───────────────────────────────────────────────────────────────────
function TopNav() {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [hov, setHov] = useState(null)
  const [modules, setModules] = useState([])

  useEffect(() => {
    if (!user) { setModules([]); return }
    const fetchModules = () => api.get('/modules').then(setModules).catch(() => {})
    fetchModules()
    window.addEventListener('thrivebase:modules-changed', fetchModules)
    return () => window.removeEventListener('thrivebase:modules-changed', fetchModules)
  }, [user])
  const navModules = modules.filter(m => m.enabled && m.nav_path)

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

      {/* module icons — rendered dynamically from enabled modules */}
      {navModules.map(m => (
        <button key={m.id} onClick={() => navigate(m.nav_path)} title={m.name}
          style={iconBtn(m.id)}
          onMouseEnter={() => setHov(m.id)}
          onMouseLeave={() => setHov(null)}>
          {m.icon || '📦'}
        </button>
      ))}

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

// ── shell ─────────────────────────────────────────────────────────────────────
function Shell() {
  return (
    <>
      <TopNav />
      <main style={{ marginTop: 48, minHeight: 'calc(100vh - 48px)' }}>
        <Routes>
          <Route path="/"         element={<LandingPage />} />
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