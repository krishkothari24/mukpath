import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Column, Field, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContent } from '@/lib/content';
import { usePractice } from '@/lib/practice';
import { addDays, daysBetween } from '@/lib/scheduler';
import { listTexts } from '@/lib/db';
import type { Goal, Text as TextRow } from '@/lib/types';

/**
 * Goals: pick a text and a date, and the app works out the daily pace.
 *
 * The pace is what makes a goal more than a wish — it feeds the practice
 * queue's new-verse cap (lib/practice.tsx `newLimitFor`), so committing to
 * a date genuinely changes how much material tomorrow introduces.
 */
export default function GoalsScreen() {
  const { ready, goals, createGoal, deleteGoal, syncing, error, today } = usePractice();
  const { ready: contentReady, revision } = useContent();

  const [texts, setTexts] = useState<TextRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState(() => addDays(new Date(), 30));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentReady) return;
    let cancelled = false;
    listTexts()
      .then((rows) => {
        if (!cancelled) {
          setTexts(rows);
          setTextsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTextsError(err instanceof Error ? err.message : 'Could not load texts');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contentReady, revision]);

  const goalTargets = useMemo(() => new Set(goals.map((goal) => goal.target_id)), [goals]);

  if (!ready || !contentReady) return <Loading />;

  const onSave = async () => {
    setFormError(null);
    if (!selected) {
      setFormError('Pick a text first.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(Date.parse(targetDate))) {
      setFormError('Use a date like 2026-12-31.');
      return;
    }
    if (daysBetween(today, targetDate) <= 0) {
      setFormError('Pick a date in the future.');
      return;
    }

    setSaving(true);
    try {
      await createGoal({ target_type: 'text', target_id: selected, target_date: targetDate });
      setSelected(null);
    } catch (err) {
      // Goals are the one thing that needs connectivity — say so plainly
      // rather than pretending it saved.
      setFormError(err instanceof Error ? err.message : 'Could not save that goal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Goals' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Column style={styles.body}>
          {error ? <Banner tone="error">{error}</Banner> : null}

          {goals.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No goal yet. Without one the app introduces a few new verses a day; with one it
              works backwards from your date.
            </ThemedText>
          ) : (
            goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onDelete={() => deleteGoal(goal.id)} busy={syncing} />
            ))
          )}

          <Card>
            <ThemedText type="smallBold">Set a goal</ThemedText>

            {textsError ? (
              <Banner tone="error">{textsError}</Banner>
            ) : texts.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No texts on this device yet — sync from the library screen first.
              </ThemedText>
            ) : (
              <>
                <View style={styles.picker}>
                  {texts.map((text) => (
                    <TextChip
                      key={text.id}
                      label={text.name}
                      selected={selected === text.id}
                      // A text with a goal can be re-picked — that moves the date.
                      hint={goalTargets.has(text.id) ? 'has a goal' : null}
                      onPress={() => setSelected(text.id)}
                    />
                  ))}
                </View>

                <Field
                  label="Finish by (YYYY-MM-DD)"
                  value={targetDate}
                  onChangeText={setTargetDate}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="2026-12-31"
                  keyboardType="numbers-and-punctuation"
                />

                {formError ? <Banner tone="error">{formError}</Banner> : null}

                <Button label="Save goal" onPress={onSave} busy={saving} />
              </>
            )}
          </Card>
        </Column>
      </ScrollView>
    </>
  );
}

function GoalCard({ goal, onDelete, busy }: { goal: Goal; onDelete: () => void; busy: boolean }) {
  const theme = useTheme();
  const fraction = goal.total > 0 ? goal.started / goal.total : 0;

  return (
    <Card>
      <ThemedText type="default" style={styles.goalTitle}>
        {goal.target_name ?? goal.target_id}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {goal.started} of {goal.total} started · {goal.mastered} mastered
      </ThemedText>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(fraction * 100)}%`, backgroundColor: theme.tint },
          ]}
        />
      </View>

      <ThemedText type="small" themeColor={goal.pace.behind ? 'danger' : 'textSecondary'}>
        {paceLine(goal)}
      </ThemedText>

      <Button variant="secondary" label="Remove goal" onPress={onDelete} busy={busy} />
    </Card>
  );
}

function paceLine(goal: Goal): string {
  if (goal.pace.remaining === 0) return `All ${goal.total} started — now it's review.`;
  if (goal.pace.behind) {
    return `${goal.target_date} has passed with ${goal.pace.remaining} left to start.`;
  }
  const days = goal.pace.daysLeft;
  return `${goal.pace.perDay} new a day for ${days} ${days === 1 ? 'day' : 'days'} to finish by ${goal.target_date}.`;
}

function TextChip({
  label,
  selected,
  hint,
  onPress,
}: {
  label: string;
  selected: boolean;
  hint: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.tint : theme.border,
          backgroundColor: selected ? theme.tint : 'transparent',
        },
      ]}>
      <ThemedText type="small" style={{ color: selected ? theme.tintText : theme.text }}>
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" style={{ color: selected ? theme.tintText : theme.textSecondary }}>
          {hint}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.three, paddingBottom: Spacing.six },
  body: { gap: Spacing.three },
  goalTitle: { fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    alignItems: 'center',
  },
});
