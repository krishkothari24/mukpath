import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/**
 * Phrase-at-a-time reveal of a verse's chunks.
 *
 * Shared between the scheduled practice session (`app/practice.tsx`, which
 * adds grading once fully revealed) and free practice (`app/free-practice.tsx`,
 * which has no grading — see CLAUDE.md's practice loop). Dumping the whole
 * answer at once turns recall into recognition, so the caller owns
 * `revealed` and drives it forward via these two callbacks; this component
 * only renders the state it's given.
 */
export function PhraseReveal({
  chunks,
  revealed,
  onReveal,
  onRevealAll,
  keyPrefix,
}: {
  chunks: string[];
  revealed: number;
  onReveal: () => void;
  onRevealAll: () => void;
  keyPrefix: string;
}) {
  const fullyRevealed = revealed >= chunks.length;

  return (
    <Card>
      {chunks.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing recorded for this script — switch above.
        </ThemedText>
      ) : revealed === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Recite it from memory, then reveal to check.
        </ThemedText>
      ) : (
        chunks.slice(0, revealed).map((chunk, index) => (
          <ThemedText key={`${keyPrefix}-${index}`} style={styles.verseLine}>
            {chunk}
          </ThemedText>
        ))
      )}

      {!fullyRevealed && chunks.length > 0 ? (
        <View style={styles.revealRow}>
          <View style={styles.revealSlot}>
            <Button
              variant="secondary"
              label={revealed === 0 ? 'Reveal first phrase' : 'Next phrase'}
              onPress={onReveal}
            />
          </View>
          <View style={styles.revealSlot}>
            <Button variant="secondary" label="Show all" onPress={onRevealAll} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  verseLine: { fontSize: 20, lineHeight: 34 },
  revealRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  revealSlot: { flex: 1 },
});
