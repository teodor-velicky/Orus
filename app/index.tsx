import { View } from 'react-native'
import { color } from '../lib/theme'

// The root layout's gate redirects from here once the session is known.
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: color.bg }} />
}
