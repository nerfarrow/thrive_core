// =============================================================================
// LandingPage.jsx — Module hub / home screen
// thrive_base UI
// =============================================================================
import { useAuth } from '../context/AuthContext'

export default function LandingPage() {
  const { user } = useAuth()
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 2rem' }}>
      <div style={{ marginBottom: '3rem' }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 28, fontWeight: 700, letterSpacing: '0.06em' }}>thrive</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>
          Welcome back, {user?.username}
        </div>
      </div>

      {/* module grid — populated as modules are installed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <div style={{ background: 'var(--bg-secondary,#181818)', border: '2px dashed var(--border-color,#2a2a2a)', borderRadius: 12, padding: '32px 24px', textAlign: 'center', color: 'var(--text-tertiary,#555)', fontSize: 12, lineHeight: 1.8 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>＋</div>
          No modules installed yet.<br />
          Go to Settings → Modules<br />to add features.
        </div>
      </div>
    </div>
  )
}