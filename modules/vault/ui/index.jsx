// modules/vault/ui/index.jsx — vault module UI registration (build-time discovered)
// VaultItems + utils/vault stay in core (shared: budget's Accounts links vault
// items too). The Settings connection panel is module-owned.
import VaultPage from './VaultPage'
import VaultPanel from './VaultPanel'

export default {
  id: 'vault',
  path: '/vault',
  Page: VaultPage,
  settings: { title: 'Vault', defaultOpen: false, Panel: VaultPanel },
}
