// modules/steam/ui/index.jsx — Steam module UI registration (build-time discovered)
import SteamPage from './SteamPage'
import SteamPanel from './SteamPanel'

export default {
  id: 'steam',
  path: '/steam',
  Page: SteamPage,
  settings: { title: 'Steam', defaultOpen: false, Panel: SteamPanel },
}
