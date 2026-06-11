// modules/gog/ui/index.jsx — GOG module UI registration (build-time discovered)
import GOGPage from './GOGPage'
import GOGPanel from './GOGPanel'

export default {
  id: 'gog',
  path: '/gog',
  Page: GOGPage,
  settings: { title: 'GOG', defaultOpen: false, Panel: GOGPanel },
}
