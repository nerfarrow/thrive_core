// modules/vehicles/ui/index.jsx — vehicles module UI registration
// VehiclesPage embeds MPGPage (the fuel log) as a sibling within the module.
import VehiclesPage from './VehiclesPage'

export default {
  id: 'vehicles',
  path: '/vehicles',
  Page: VehiclesPage,
}
