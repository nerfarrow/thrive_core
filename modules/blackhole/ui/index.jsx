// modules/blackhole/ui/index.jsx — black-hole module UI registration
// Declares an Ambient renderer, so core can paint it behind the UI when chosen.
import BlackHolePage from './BlackHolePage'
import BlackHoleBackground from 'blackhole-lensing/react/BlackHoleBackground'

export default {
  id: 'blackhole',
  path: '/blackhole',
  Page: BlackHolePage,
  Ambient: BlackHoleBackground,
}
