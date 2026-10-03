import { StyleSheet, View } from 'react-native';
import { AsyncView } from '@/components/AsyncView';
import { AppText, Badge, Card, EmptyBlock, Screen } from '@/components/ui';
import { listApprovals } from '@/lib/api';
import { relativeTime, titleCase } from '@/lib/format';
import type { ApprovalItem } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { approvalStateColor, colors, spacing } from '@/theme/tokens';

export default function ApprovalsScreen() {
  const state = useAsync(() => listApprovals({ state: 'pending', limit: 25 }), []);

  return (
    <Screen
      eyebrow="Queue"
      title="Approvals"
      subtitle="Outbound actions waiting on you. The phone is read-only — approve from the web app."
    >
      <AsyncView state={state} emptyMessage="No pending approvals.">
        {(page) => {
          if (page.items.length === 0) {
            return <EmptyBlock message="Nothing is waiting for approval." />;
          }
          return (
            <>
              <AppText variant="muted">{`${page.items.length} pending`}</AppText>
              {page.items.map((item) => (
                <ApprovalCard key={item.id} item={item} />
              ))}
            </>
          );
        }}
      </AsyncView>
    </Screen>
  );
}

function summary(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['title', 'summary', 'message', 'subject']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    const serialized = JSON.stringify(payload);
    return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized;
  }
  if (typeof payload === 'string') return payload;
  return 'No details attached.';
}

function ApprovalCard({ item }: { item: ApprovalItem }) {
  return (
    <Card style={styles.card}>
      <View style={styles.rowBetween}>
        <AppText variant="heading">{titleCase(item.kind)}</AppText>
        <Badge label={titleCase(item.state)} tone={approvalStateColor(item.state)} />
      </View>
      <AppText variant="muted">{summary(item.payload)}</AppText>
      <AppText variant="label">{`Created ${relativeTime(item.createdAt)}`}</AppText>
      {item.failedReason ? (
        <AppText variant="muted" color={colors.danger}>
          {item.failedReason}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
