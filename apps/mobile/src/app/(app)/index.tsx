import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AsyncView } from '@/components/AsyncView';
import { AppText, Badge, Button, Card, Divider, EmptyBlock, Screen } from '@/components/ui';
import { getLatestBrief, previewBrief } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { BriefLatestRow, DailyBriefPayload } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { colors, spacing } from '@/theme/tokens';

function latestPayload(rows: BriefLatestRow[]): { payload: DailyBriefPayload | null; composedAt: string | null } {
  const first = rows[0];
  if (!first) return { payload: null, composedAt: null };
  return { payload: first.payload, composedAt: first.composedAt };
}

export default function TodayScreen() {
  const brief = useAsync(() => getLatestBrief(), []);
  const [preview, setPreview] = useState<DailyBriefPayload | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function compose() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await previewBrief());
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Could not compose a brief.');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Screen
      eyebrow="Daily brief"
      title="Today"
      subtitle="XP, streak, open remediation, and recent matches — composed server-side from your evidence graph."
    >
      {preview ? (
        <BriefCard payload={preview} composedAt={preview.composedAt} preview />
      ) : (
        <AsyncView
          state={brief}
          emptyMessage="No brief has been composed yet."
          onRetry={brief.reload}
        >
          {(rows) => {
            const { payload, composedAt } = latestPayload(rows);
            if (!payload) {
              return <EmptyBlock message="The scheduler hasn't composed a brief yet." />;
            }
            return <BriefCard payload={payload} composedAt={composedAt} />;
          }}
        </AsyncView>
      )}
      {previewError ? (
        <AppText variant="muted" color={colors.danger}>
          {previewError}
        </AppText>
      ) : null}
      <Button
        label="Compose a preview"
        variant="secondary"
        onPress={compose}
        loading={previewing}
        fullWidth
      />
    </Screen>
  );
}

function BriefCard({
  payload,
  composedAt,
  preview = false,
}: {
  payload: DailyBriefPayload;
  composedAt: string | null;
  preview?: boolean;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.rowBetween}>
        <AppText variant="eyebrow">{preview ? 'Preview' : 'Latest brief'}</AppText>
        {preview ? (
          <Badge label="Not saved" tone={colors.warn} />
        ) : composedAt ? (
          <AppText variant="muted">{relativeTime(composedAt)}</AppText>
        ) : null}
      </View>

      <View style={styles.statRow}>
        <Stat label="Total XP" value={String(payload.xp.totalXp)} />
        <Stat
          label="Last 24h"
          value={payload.xp.deltaLast24h >= 0 ? `+${payload.xp.deltaLast24h}` : String(payload.xp.deltaLast24h)}
        />
        <Stat label="Streak" value={`${payload.streak.currentDays}d`} />
        <Stat label="Longest" value={`${payload.streak.longestDays}d`} />
      </View>

      <Divider />
      <AppText variant="eyebrow">Open remediation</AppText>
      {payload.quests.length === 0 ? (
        <AppText variant="muted">Nothing open. Nice.</AppText>
      ) : (
        payload.quests.map((quest) => (
          <View key={quest.id} style={styles.listRow}>
            <AppText variant="body">{quest.title}</AppText>
            {quest.skillName ? <AppText variant="muted">{quest.skillName}</AppText> : null}
          </View>
        ))
      )}

      <Divider />
      <AppText variant="eyebrow">Recent matches</AppText>
      {payload.jobMatches.length === 0 ? (
        <AppText variant="muted">No new matches in the last 24h.</AppText>
      ) : (
        payload.jobMatches.map((match) => (
          <View key={match.id} style={styles.listRow}>
            <AppText variant="body">{match.title || 'Untitled role'}</AppText>
            <AppText variant="muted">
              {[match.company, match.location].filter(Boolean).join(' · ') || '—'}
            </AppText>
          </View>
        ))
      )}

      {payload.marketPulse ? (
        <>
          <Divider />
          <AppText variant="eyebrow">Market pulse</AppText>
          <AppText variant="muted">
            {payload.marketPulse.risingSkill
              ? `Rising: ${payload.marketPulse.risingSkill}`
              : 'No rising skill in the latest snapshot.'}
          </AppText>
        </>
      ) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="heading">{value}</AppText>
      <AppText variant="label">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stat: { minWidth: 64, gap: 2 },
  listRow: { gap: 2 },
});
