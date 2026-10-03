import { useState } from 'react';
import { AppText, Button, Card, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { colors, spacing } from '@/theme/tokens';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      eyebrow="Career OS"
      title="Welcome back"
      subtitle="Sign in with your local account. Your credentials are verified by the API and exchanged for a device token — the same durable JWT + refresh model the desktop agent uses."
    >
      <Card style={{ gap: spacing.lg }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        {error ? (
          <AppText variant="muted" color={colors.danger}>
            {error}
          </AppText>
        ) : null}
        <Button label="Sign in" onPress={onSubmit} loading={submitting} fullWidth />
      </Card>
      <AppText variant="mono" color={colors.fgFaint}>
        API · {API_URL}
      </AppText>
    </Screen>
  );
}
