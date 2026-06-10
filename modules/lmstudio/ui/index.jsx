// modules/lmstudio/ui/index.jsx — LM Studio module UI registration (build-time discovered)
import LMStudioPage from './LMStudioPage'
import LMStudioPanel from './LMStudioPanel'

export default {
  id: 'lmstudio',
  path: '/lmstudio',
  Page: LMStudioPage,
  settings: { title: 'LM Studio', defaultOpen: false, Panel: LMStudioPanel },
}
