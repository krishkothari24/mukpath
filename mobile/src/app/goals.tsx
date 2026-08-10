import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContent } from '@/lib/content';
import { usePractice } from '@/lib/practice';
import { addDays, daysBetween } from '@/lib/scheduler';
import { listTexts } from '@/lib/db';
import type { Goal, Text as TextRow } from '@/lib/types';

/** Group flat goal rows by their plan, in the plan's target-date order.
 *  Goals with no plan (set outside the multi-select form) each stand alone. */
function groupByPlan(goals: Goal[]): { key: string; goals: Goal[] }[] {
  const order: string[] = [];
  const byKey = new Map<string, Goal[]>();
  for (const goal of goals) {
    const key = goal.plan_id ?? goal.id;
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, []);
    }
    byKey.get(key)!.push(goal);
  }
  return order.map((key) => ({ key, goals: byKey.get(key)! }));
}

/**
 * Goals: pick a text and a date, and the app works out the daily pace.
 *
 * The pace is what makes a goal more than a wish — it feeds the practice
 * queue's new-verse cap (lib/practice.tsx `newLimitFor`), so committing to
 * a date genuinely changes how much material tomorrow introduces.
 */
/** Local (not UTC) YYYY-MM-DD — matches lib/scheduler's localToday, so a
 *  picked date doesn't roll to the next/previous day for anyone off UTC. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function GoalsScreen() {
  const { ready, goals, createPlan, deleteGoal, deletePlan, syncing, error, today } = usePractice();
  const { ready: contentReady, revision } = useContent();

  const [texts, setTexts] = useState<TextRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [targetDate, setTargetDate] = useState(() => addDays(new Date(), 30));
  const [showIosPicker, setShowIosPicker] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);

  // The date one day out — the picker's floor, since "finish by today" isn't
  // a real goal (the future-date check below would reject it anyway).
  const minimumDate = useMemo(() => new Date(addDays(today, 1) + 'T00:00:00'), [today]);

  const onPickDate = (date: Date) => {
    setTargetDate(toLocalDateString(date));
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: new Date(`${targetDate}T00:00:00`),
        mode: 'date',
        minimumDate,
        onChange: (_event, selectedDate) => {
          if (selectedDate) onPickDate(selectedDate);
        },
      });
    } else {
      setShowIosPicker(true);
    }
  };

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

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const onSave = async () => {
    setFormError(null);
    if (selected.size === 0) {
      setFormError('Pick at least one text first.');
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
      await createPlan({
        target_date: targetDate,
        targets: [...selected].map((targetId) => ({ target_type: 'text', target_id: targetId })),
      });
      setSelected(new Set());
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
            groupByPlan(goals).map(({ key, goals: groupGoals }) =>
              groupGoals.length > 1 ? (
                <PlanCard
                  key={key}
                  goals={groupGoals}
                  onDelete={() => deletePlan(key)}
                  busy={syncing}
                />
              ) : (
                <GoalCard
                  key={key}
                  goal={groupGoals[0]}
                  onDelete={() => deleteGoal(groupGoals[0].id)}
                  busy={syncing}
                />
              ),
            )
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
                      selected={selected.has(text.id)}
                      // A text with a goal can be re-picked — that moves the date.
                      hasGoal={goalTargets.has(text.id)}
                      onPress={() => toggleSelected(text.id)}
                    />
                  ))}
                </View>

                <View style={styles.field}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Finish by
                  </ThemedText>
                  <DateField value={targetDate} onPress={openPicker} />
                </View>

                {/* Android's picker is its own dialog (DateTimePickerAndroid.open,
                    above); iOS has no such dialog, so it renders inline here,
                    dismissed by the Done button once a date is chosen. */}
                {showIosPicker ? (
                  <>
                    <DateTimePicker
                      value={new Date(`${targetDate}T00:00:00`)}
                      mode="date"
                      display="inline"
                      minimumDate={minimumDate}
                      onChange={(_event, selectedDate) => {
                        if (selectedDate) onPickDate(selectedDate);
                      }}
                    />
                    <Button label="Done" variant="secondary" onPress={() => setShowIosPicker(false)} />
                  </>
                ) : null}

                {formError ? <Banner tone="error">{formError}</Banner> : null}

                <Button
                  label={selected.size > 1 ? `Save ${selected.size} goals` : 'Save goal'}
                  onPress={onSave}
                  busy={saving}
                />
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

/** Several texts toward one date, shown and removed as a unit. */
function PlanCard({ goals, onDelete, busy }: { goals: Goal[]; onDelete: () => void; busy: boolean }) {
  const theme = useTheme();

  return (
    <Card>
      <ThemedText type="default" style={styles.goalTitle}>
        {goals.map((goal) => goal.target_name ?? goal.target_id).join(' + ')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {goals.length} texts by {goals[0].target_date}
      </ThemedText>

      {goals.map((goal) => {
        const fraction = goal.total > 0 ? goal.started / goal.total : 0;
        return (
          <View key={goal.id} style={styles.planRow}>
            <ThemedText type="small">{goal.target_name ?? goal.target_id}</ThemedText>
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
          </View>
        );
      })}

      <Button variant="secondary" label="Remove plan" onPress={onDelete} busy={busy} />
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
  hasGoal,
  onPress,
}: {
  label: string;
  selected: boolean;
  hasGoal: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hasGoal ? `${label}, has a goal` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? theme.tint : theme.border,
          backgroundColor: selected ? theme.tint : theme.backgroundElement,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <View
        style={[
          styles.chipCheck,
          {
            borderColor: selected ? theme.tintText : theme.textSecondary,
            backgroundColor: selected ? theme.tintText : 'transparent',
          },
        ]}>
        {selected ? <View style={[styles.chipCheckDot, { backgroundColor: theme.tint }]} /> : null}
      </View>
      <ThemedText
        type="small"
        style={{ color: selected ? theme.tintText : theme.text, fontWeight: '600' }}>
        {label}
      </ThemedText>
      {/* A text already tied to a goal can be re-picked to move its date. */}
      {hasGoal ? (
        <View
          style={[
            styles.chipDot,
            { backgroundColor: selected ? theme.tintText : theme.tint },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

/** Opens the platform date picker; shows the picked date like the rest of
 *  the input surfaces (Field's border/height), but isn't itself editable. */
function DateField({ value, onPress }: { value: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.input, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="default">{value}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.three, paddingBottom: Spacing.six },
  body: { gap: Spacing.three },
  goalTitle: { fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  planRow: { gap: Spacing.one },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: Spacing.one,
  },
  chipCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCheckDot: { width: 8, height: 8, borderRadius: 4 },
  chipDot: { width: 6, height: 6, borderRadius: 3, marginLeft: Spacing.half },
  field: { gap: Spacing.one },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
