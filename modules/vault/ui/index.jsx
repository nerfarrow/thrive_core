// modules/vault/ui/index.jsx — vault module UI registration (build-time discovered)
// VaultItems + the Settings connection panel (VaultPanel) stay in core: they're
// shared (budget's Accounts links vault items too).
import VaultPage from './VaultPage'

export default {
  id: 'vault',
  path: '/vault',
  Page: VaultPage,
}
