import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)

  const refresh = useCallback(async () => {
    try { const me = await api.get('/auth/me'); setUser(me) }
    catch { setUser(null); try { const s = await api.get('/auth/status'); setSetupNeeded(!!s.setup_needed) } catch {} }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const fn = () => setUser(null)
    window.addEventListener('thrive:unauthorized', fn)
    return () => window.removeEventListener('thrive:unauthorized', fn)
  }, [])

  const login    = async (u, p) => { const r = await api.post('/auth/login',   { username: u, password: p }); setUser(r); return r }
  const register = async (data) => { const r = await api.post('/auth/register', data); setSetupNeeded(false); setUser(r); return r }
  const logout   = async ()     => { try { await api.post('/auth/logout') } catch {}; setUser(null) }

  return (
    <AuthContext.Provider value={{ user, loading, setupNeeded, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}