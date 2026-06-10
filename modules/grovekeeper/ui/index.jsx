// modules/grovekeeper/ui/index.jsx — grovekeeper module UI registration
// Declares an Ambient renderer, so core can paint it behind the UI when chosen.
import GrovekeeperPage from './GrovekeeperPage'
import TreeBackground from 'grovekeeper/react/TreeBackground'

export default {
  id: 'grovekeeper',
  path: '/grovekeeper',
  Page: GrovekeeperPage,
  Ambient: TreeBackground,
}
