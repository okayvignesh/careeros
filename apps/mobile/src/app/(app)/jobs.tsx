import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { AsyncView } from '@/components/AsyncView';
import { AppText, Badge, Button, Card, EmptyBlock, Screen } from '@/components/ui';
import { listJobs } from '@/lib/api';
import { relativeTime, titleCase } from '@/lib/format';
import type { JobListItem } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { colors, spacing } from '@/theme/tokens';

const PAGE = 25;
const MAX = 200;

export default function JobsScreen() {
  const [limit, setLimit] = useState(PAGE);
  const state = useAsync(() => listJobs(limit, 0), [limit]);

  return (
    <Screen
      eyebrow="Market"
      title="Jobs"
      subtitle="Ingested from public sources and scored against your skill graph. Read-only."
    >
      <AsyncView state={state} emptyMessage="No jobs have been ingested yet.">
        {(data) => {
          if (data.jobs.length === 0) {
            return <EmptyBlock message="No jobs match the current preferences yet." />;
          }
          return (
            <>
              <AppText variant="muted">
                {`Showing ${data.jobs.length} of ${data.total}`}
              </AppText>
              {data.jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
              {data.total > data.jobs.length && limit < MAX ? (
                <Button
                  label="Load more"
                  variant="secondary"
                  fullWidth
                  onPress={() => setLimit((current) => Math.min(current + PAGE, MAX))}
                />
              ) : null}
            </>
          );
        }}
      </AsyncView>
    </Screen>
  );
}

function matchTone(score: number | null): string {
  if (score === null) return colors.fgSubtle;
  if (score >= 70) return colors.success;
  if (score >= 40) return colors.warn;
  return colors.fgSubtle;
}

function JobCard({ job }: { job: JobListItem }) {
  const score = job.match.score;
  const place = [job.location, job.remote ? 'Remote' : null].filter(Boolean).join(' · ');
  return (
    <Card style={styles.card}>
      <View style={styles.rowBetween}>
        <AppText variant="heading" style={styles.title}>
          {job.title || 'Untitled role'}
        </AppText>
        <Badge
          label={score === null ? 'No score' : `${Math.round(score)}% match`}
          tone={matchTone(score)}
        />
      </View>
      <AppText variant="muted">{job.company || 'Unknown company'}</AppText>
      {place ? <AppText variant="muted">{place}</AppText> : null}
      <View style={styles.badgeRow}>
        <Badge label={titleCase(job.state)} tone={colors.accent} />
        <Badge label={job.primarySource} tone={colors.fgSubtle} />
      </View>
      <AppText variant="label">
        {`Posted ${relativeTime(job.sourcePostedAt)} · ${job.match.matched}/${job.match.total} skills matched`}
      </AppText>
      <Button label="Open listing" variant="ghost" onPress={() => void Linking.openURL(job.canonicalUrl)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
