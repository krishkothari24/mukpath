import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Column, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isRegister) {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (!isRegister || name.trim().length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Column style={styles.form}>
            <View style={styles.heading}>
              <ThemedText type="subtitle">Mukhpath</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isRegister
                  ? 'Create an account to track what you have memorised.'
                  : 'Sign in to pick up where you left off.'}
              </ThemedText>
            </View>

            {error ? <Banner tone="error">{error}</Banner> : null}

            {isRegister ? (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />
            ) : null}

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />

            <Field
              label={isRegister ? 'Password (8+ characters)' : 'Password'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              textContentType={isRegister ? 'newPassword' : 'password'}
              onSubmitEditing={() => canSubmit && submit()}
            />

            <Button
              label={isRegister ? 'Create account' : 'Sign in'}
              onPress={submit}
              busy={busy}
              disabled={!canSubmit}
            />

            <Button
              variant="secondary"
              label={isRegister ? 'I already have an account' : 'Create an account'}
              onPress={() => {
                setMode(isRegister ? 'login' : 'register');
                setError(null);
              }}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
              Server: {API_URL}
            </ThemedText>
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: Spacing.five },
  form: { gap: Spacing.three },
  heading: { gap: Spacing.one, marginBottom: Spacing.two },
  // The dev backend's address is the single most common thing to get wrong on
  // a physical device, so it is on screen rather than in a log.
  footer: { textAlign: 'center', marginTop: Spacing.two },
});
