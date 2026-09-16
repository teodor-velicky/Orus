// Strava OAuth (mobile flow) + sync. Token exchange happens server-side in
// the `strava` edge function so the client secret never ships in the app.
//
// Strava app settings: Authorization Callback Domain = "orus.app"
// (matches the redirect below: orus://orus.app).

import * as WebBrowser from 'expo-web-browser'
import { invokeFn } from './supabase'
import { isExpoGo } from './env'

const CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ?? ''
const REDIRECT = 'orus://orus.app'

export const isStravaConfigured = () => CLIENT_ID.length > 0

/** The orus:// redirect only exists in the installed app, not inside Expo Go. */
export const canConnectStrava = () => isStravaConfigured() && !isExpoGo

export interface StravaStatus { connected: boolean; athleteName: string | null; lastSyncAt: string | null }

export async function connectStrava(): Promise<{ athleteName: string | null; imported: number } | null> {
  const url =
    'https://www.strava.com/oauth/mobile/authorize' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    '&response_type=code&approval_prompt=auto&scope=read,activity:read_all'

  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT)
  if (result.type !== 'success') return null
  const params = new URL(result.url).searchParams
  const code = params.get('code')
  if (!code) throw new Error(params.get('error') ?? 'Strava did not return a code')
  return invokeFn('strava', { action: 'exchange', code })
}

export const stravaStatus = () => invokeFn<StravaStatus>('strava', { action: 'status' })
export const syncStrava = (days = 30) => invokeFn<{ imported: number }>('strava', { action: 'sync', days })
export const disconnectStrava = () => invokeFn('strava', { action: 'disconnect' })
