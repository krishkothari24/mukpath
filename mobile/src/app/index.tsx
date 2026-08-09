import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Centered, Column, ListRow, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useContent } from '@/lib/content';
import { listTexts, verseCountsByText } from '@/lib/db';
import { usePractice } from '@/lib/practice';
import type { Text as TextRow } from '@/lib/types';

export default function TextsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { ready, syncing, error, hasContent, lastSync, resync, revision } = useContent();

  const [texts, setTexts] = useState<TextRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Reads always come from SQLite; `revision` re-runs them after a sync lands.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setReadError(null);
      try {
        const [rows, verseCounts] = await Promise.all([listTexts(), verseCountsByText()]);
        if (cancelled) return;
        setTexts(rows);
        setCounts(verseCounts);
      } catch (err) {
        if (!cancelled) setReadError(err instanceof Error ? err.message : 'Could not read the library');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, revision, attempt]);

  // The practice card is the whole point of the app, so it sits above the
  // library rather than behind a tab: the default action on opening should be
  // "do today's practice", not "browse".
  const renderHeader = useCallback(
    () => (
      <Column style={styles.header}>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <PracticeCard />
      </Column>
    ),
    [error],
  );

  if (!ready || loading) {
    return <Loading label="Opening your library…" />;
  }

  if (readError) {
    return (
      <Centered>
        <ThemedText type="default" style={styles.emptyTitle}>
          Couldn&apos;t open your library
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          {readError}
        </ThemedText>
        <Button label="Try again" onPress={() => setAttempt((count) => count + 1)} />
      </Centered>
    );
  }

  if (!hasContent) {
    return (
      <Centered>
        <ThemedText type="default" style={styles.emptyTitle}>
          No content yet
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          {error ?? 'Nothing has been downloaded to this device yet.'}
        </ThemedText>
        <Button label="Try again" onPress={resync} busy={syncing} />
      </Centered>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Mukhpath' }} />
      <FlatList
        data={texts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={resync} />}
        renderItem={({ item }) => (
          <Column>
            <ListRow
              title={item.name}
              subtitle={item.description || null}
              meta={counts[item.id] ? `${counts[item.id]}` : null}
              onPress={() => router.push(`/text/${item.id}`)}
            />
          </Column>
        )}
        ListFooterComponent={
          <Column style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              {user ? `Signed in as ${user.name}` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {lastSync
                ? `Content last updated ${lastSync.toLocaleDateString()}`
                : 'Content not downloaded yet'}
            </ThemedText>
            <View style={styles.signOut}>
              <Button
                variant="secondary"
                label="Sign out"
                onPress={async () => {
                  await logout();
                  router.replace('/login');
                }}
              />
            </View>
          </Column>
        }
      />
    </>
  );
}

/** Today's queue at a glance, and the way into it. */
function PracticeCard() {
  const router = useRouter();
  const { ready, summary, streak, goals, pending } = usePractice();

  if (!ready) return null;

  const total = summary.due + summary.newToday;
  const goal = goals[0] ?? null;

  return (
    <Card style={styles.practiceCard}>
      <View style={styles.practiceCardHeader}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          TODAY
        </ThemedText>
        {streak.current > 0 ? (
          <ThemedText type="smallBold" themeColor={streak.practicedToday ? 'text' : 'textSecondary'}>
            🔥 {streak.current} day{streak.current === 1 ? '' : 's'}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="default" style={styles.practiceHeadline}>
        {total > 0
          ? `${total} to practise — ${summary.due} due, ${summary.newToday} new`
          : summary.newAvailable > 0
            ? 'Nothing due — you’re ahead'
            : 'Every verse is scheduled'}
      </ThemedText>

      {goal ? (
        <ThemedText type="small" themeColor={goal.pace.behind ? 'danger' : 'textSecondary'}>
          {goal.target_name}: {goal.started}/{goal.total} started, {goal.pace.perDay}/day to finish
          by {goal.target_date}
        </ThemedText>
      ) : null}

      {/* Unsent reviews aren't an error — the outbox retries — but hiding
          them entirely makes a long offline stretch look like data loss. */}
      {pending > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {pending} {pending === 1 ? 'review' : 'reviews'} waiting to sync
        </ThemedText>
      ) : null}

      <Button
        label={total > 0 ? 'Start practice' : 'Practise anyway'}
        onPress={() => router.push('/practice')}
      />
      <View style={styles.practiceCardActions}>
        <View style={styles.practiceCardAction}>
          <Button variant="secondary" label="Goals" onPress={() => router.push('/goals')} />
        </View>
        <View style={styles.practiceCardAction}>
          <Button variant="secondary" label="Reminders" onPress={() => router.push('/reminders')} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.five },
  header: { paddingTop: Spacing.three, gap: Spacing.three },
  practiceCard: { marginBottom: Spacing.two },
  practiceCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  practiceCardActions: { flexDirection: 'row', gap: Spacing.two },
  practiceCardAction: { flex: 1 },
  practiceHeadline: { fontWeight: '600' },
  footer: { paddingTop: Spacing.five, alignItems: 'center', gap: Spacing.one },
  signOut: { alignSelf: 'stretch', paddingTop: Spacing.three },
  emptyTitle: { fontWeight: '600' },
  emptyBody: { textAlign: 'center', marginVertical: Spacing.two },
});
