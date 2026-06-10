// modules/lmstudio/ui/index.jsx — LM Studio module UI registration (build-time discovered)
// Note: the Settings panel (LMStudioPanel) still lives in core, pending
// settings-panel discovery — only the nav page is module-owned for now.
import LMStudioPage from './LMStudioPage'

export default {
  id: 'lmstudio',
  path: '/lmstudio',
  Page: LMStudioPage,
}
