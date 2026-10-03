import { useState } from 'react';
import { AsyncView } from '@/components/AsyncView';
import { AppText, Button, Card, Divider, KeyValue, Screen } from '@/components/ui';
import { getBriefPreferences, getMe } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { colors, spacing } from '@/theme/tokens';

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const me = useAsync(() => getMe(), []);
  const prefs = useAsync(() => getBriefPreferences(), []);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Screen
      eyebrow="Settings"
      title="Account"
      subtitle="Identity, delivery preferences, and the API this device is paired to."
    >
      <Card style={{ gap: spacing.sm }}>
        <AppText variant="eyebrow">Signed in as</AppText>
        <AsyncView state={me} emptyMessage="No profile returned.">
          {(profile) => (
            <>
              <AppText variant="heading">{profile.displayName ?? 'Your account'}</AppText>
              <AppText variant="muted">{profile.email ?? session?.email ?? '—'}</AppText>
            </>
          )}
        </AsyncView>
        <Divider />
        <KeyValue label="Device" value={session?.deviceId ?? '—'} />
        <KeyValue label="Token expires" value={formatDateTime(session?.expiresAt ?? null)} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="eyebrow">Daily brief</AppText>
        <AsyncView
          state={prefs}
          emptyMessage="Brief preferences have not been configured yet (opt-in is off)."
        >
          {(p) =>
            p === null ? (
              <AppText variant="muted">Brief preferences have not been configured yet.</AppText>
            ) : (
              <>
                <KeyValue label="Enabled" value={p.isEnabled ? 'Yes' : 'No'} />
                <KeyValue label="Timezone" value={p.timezone} />
                <KeyValue label="Send hour" value={`${String(p.sendHourLocal).padStart(2, '0')}:00 local`} />
                <KeyValue label="Channels" value={p.channels.join(', ') || '—'} />
                <KeyValue
                  label="Snoozed until"
                  value={p.snoozedUntil ? formatDateTime(p.snoozedUntil) : 'Not snoozed'}
                />
                <KeyValue label="Last sent" value={formatDateTime(p.lastSentAt)} />
              </>
            )
          }
        </AsyncView>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="eyebrow">Connection</AppText>
        <KeyValue label="API" value={API_URL} />
        <KeyValue label="Platform" value="Expo / React Native" />
      </Card>

      <Button
        label="Sign out"
        variant="secondary"
        fullWidth
        loading={signingOut}
        onPress={() => {
          setSigningOut(true);
          void signOut().finally(() => setSigningOut(false));
        }}
      />
      <AppText variant="muted" color={colors.fgFaint}>
        Signing out revokes this device on the server and clears its keychain entry.
      </AppText>
    </Screen>
  );
}
