// Lock screen widget access (see scripts/orus-widget.js).

import { supabase } from './supabase'


/** Create or rotate the widget token and return the link the widget fetches. */
export async function createWidgetLink(): Promise<string> {
  const { data, error } = await supabase.rpc('create_widget_token')
  if (error) throw new Error(error.message)
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/widget?token=${data as string}`
}

export async function hasWidgetToken(userId: string): Promise<boolean> {
  const { data } = await supabase.from('widget_tokens').select('user_id').eq('user_id', userId).maybeSingle()
  return !!data
}

export async function revokeWidgetToken(userId: string): Promise<void> {
  const { error } = await supabase.from('widget_tokens').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}
