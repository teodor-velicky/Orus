import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { color, space, type } from '../lib/theme'
import { Button, Field, Screen } from '../components/ui'
import { Logo } from '../components/Logo'

export default function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!email.includes('@') || password.length < 6) {
      Alert.alert('Check your details', 'Enter an email and a password of at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { name: name.trim() } },
        })
        if (error) throw error
        if (!data.session) {
          Alert.alert('Confirm your email', 'We sent a confirmation link. Open it, then sign in.')
          setMode('in')
        }
      }
    } catch (e) {
      Alert.alert(mode === 'in' ? 'Sign in failed' : 'Sign up failed', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xl}>
      <KeyboardAvoidingView behavior="padding">
        <View style={{ paddingTop: 64, paddingBottom: 48, alignItems: 'center' }}>
          <Logo size={72} />
          <Text style={[type.hero, { fontSize: 44, lineHeight: 50, marginTop: space.xl, letterSpacing: -1.5 }]}>Orus</Text>
          <Text style={[type.sub, { marginTop: space.xs, textAlign: 'center' }]}>Sleep, training and food — for two.</Text>
        </View>

        {mode === 'up' ? (
          <Field label="Name" value={name} onChangeText={setName} placeholder="Your first name" autoCapitalize="words" />
        ) : null}
        <Field
          label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com"
          autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
        />
        <Field
          label="Password" value={password} onChangeText={setPassword} placeholder="••••••••"
          secureTextEntry textContentType={mode === 'in' ? 'password' : 'newPassword'}
        />

        <Button label={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} style={{ marginTop: space.s }} />
        <Button
          variant="ghost"
          label={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
          style={{ marginTop: space.s }}
        />
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.xl, color: color.textTertiary }]}>
          Your data is private to you and the person you invite.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  )
}
