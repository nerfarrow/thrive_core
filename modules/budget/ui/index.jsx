// modules/budget/ui/index.jsx — budget module UI registration (build-time discovered)
// The budget module is a cluster: BudgetPage owns sub-routing (/budget/*) over its
// pages/ (accounts, transactions, categories, payees, scheduled, reports), with its
// own components/, utils/ and stylesheets co-located here. Core-shared bits (api,
// contexts, utils/vault) are reached via @core. The PlaidPanel/VaultPanel Settings
// panels still live in core pending settings-panel discovery.
import BudgetPage from './pages/BudgetPage'

export default {
  id: 'budget',
  path: '/budget/*',
  Page: BudgetPage,
}
