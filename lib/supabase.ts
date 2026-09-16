import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Refresh tokens only while the app is foregrounded.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})

/**
 * Invoke an edge function and surface the REAL error body instead of
 * supabase-js's generic "non-2xx status code" message.
 */
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let detail = error.message ?? 'Request failed'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.status === 'number') {
      try {
        const text = await ctx.text()
        try {
          detail = `${ctx.status}: ${JSON.parse(text).error ?? text.slice(0, 200)}`
        } catch {
          detail = `${ctx.status}: ${text.slice(0, 200)}`
        }
      } catch {
        detail = `HTTP ${ctx.status}`
      }
    }
    throw new Error(`${name} failed — ${detail}`)
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data as T
}
