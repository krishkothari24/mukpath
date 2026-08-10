import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AudioBar } from '@/components/audio-bar';
import { LanguageToggle } from '@/components/language-toggle';
import { PhraseReveal } from '@/components/phrase-reveal';
import { RecordingBar } from '@/components/recording-bar';
import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Centered, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { verseAudioUri } from '@/lib/audio-cache';
import { useContent } from '@/lib/content';
import { listVerses, listWeakestVerses } from '@/lib/db';
import { verseAudio, verseChunks, verseQuestion, verseReference, type Verse } from '@/lib/types';

/**
 * Free practice: the same phrase-by-phrase reveal as the scheduled session
 * (`app/practice.tsx`), but over a verse list instead of today's SRS queue,
 * and with no grading. It doesn't touch `progress`/`review_events`, so
 * drilling a verse here can't be mistaken for a real review and can't skew
 * the schedule (see CLAUDE.md: `progress` is the scheduler's own
 * bookkeeping).
 *
 * `sectionId` picks a specific section's verses in corpus order. Without
 * one, it falls back to the learner's weakest started verses (lowest ease,
 * most lapses first) — this is where "Practise anyway" lands once today's
 * queue is empty, so finishing early leads to more reps on what's actually
 * hard rather than a dead end.
 *
 * `focus` (a verse id) picks the starting position when jumping in from a
 * specific verse rather than the top of the list.
 */
export default function FreePracticeScreen() {
  const { sectionId, focus } = useLocalSearchParams<{
    sectionId?: string;
    focus?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const { ready, revision, language } = useContent();

  const [verses, setVerses] = useState<Verse[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      setError(null);
      try {
        const rows = sectionId ? await listVerses(sectionId) : await listWeakestVerses();
        if (cancelled) return;
        setVerses(rows);
        const startAt = focus ? Math.max(0, rows.findIndex((row) => row.id === focus)) : 0;
        setPosition(startAt);
        setRevealed(0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load these verses");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, revision, sectionId, focus, attempt]);

  const verse = verses?.[position] ?? null;
  const chunks = useMemo(
    () => (verse ? verseChunks(verse, language) : []),
    [language, verse],
  );

  const goTo = (index: number) => {
    setPosition(index);
    setRevealed(0);
  };

  if (error) {
    return (
      <Centered>
        <Banner tone="error">{error}</Banner>
        <View style={styles.retryGap}>
          <Button label="Try again" onPress={() => setAttempt((count) => count + 1)} />
        </View>
      </Centered>
    );
  }

  if (!ready || !verses) return <Loading label="Loading verses…" />;

  if (verses.length === 0) {
    return (
      <Centered>
        <ThemedText type="default">
          {sectionId ? 'No verses here yet.' : "Nothing started yet — pick a text to begin."}
        </ThemedText>
      </Centered>
    );
  }

  // Unreachable given the length check above; keeps the render below simple.
  if (!verse) return <Loading />;

  const question = verseQuestion(verse, language);
  const reference = verseReference(verse, language);
  const rawAudioUrl = verseAudio(verse, language);
  const audioUrl = rawAudioUrl
    ? verseAudioUri(verse.id, language === 'english' ? 'en' : 'gu', rawAudioUrl)
    : null;
  // When reading Gujarati or Lipi, the English is a comprehension aid rather
  // than the material — show it, but secondary.
  const showMeaningAid = language !== 'english' && Boolean(verse.meaning);

  return (
    <>
      <Stack.Screen options={{ title: `${position + 1} of ${verses.length}` }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Column style={styles.body}>
          <View style={styles.eyebrow}>
            {verse.has_shlok ? (
              <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                <ThemedText type="small" style={{ color: theme.tintText, fontWeight: '700' }}>
                  Shlok
                </ThemedText>
              </View>
            ) : null}
            {reference ? (
              <ThemedText type="small" themeColor="textSecondary">
                {reference}
              </ThemedText>
            ) : null}
          </View>

          <ThemedText style={styles.question}>{question || 'Recite this verse'}</ThemedText>

          <LanguageToggle />

          <PhraseReveal
            chunks={chunks}
            revealed={revealed}
            onReveal={() => setRevealed((count) => count + 1)}
            onRevealAll={() => setRevealed(chunks.length)}
            keyPrefix={verse.id}
          />

          {showMeaningAid ? (
            <Card>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Meaning
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.meaning}>
                {verse.meaning}
              </ThemedText>
            </Card>
          ) : null}

          {audioUrl ? (
            <AudioBar
              key={audioUrl}
              url={audioUrl}
              label={language === 'english' ? 'English explanation' : 'Recitation'}
            />
          ) : null}

          <RecordingBar key={verse.id} verseId={verse.id} />

          <View style={styles.pager}>
            <View style={styles.pagerSlot}>
              {position > 0 ? (
                <Button variant="secondary" label="← Previous" onPress={() => goTo(position - 1)} />
              ) : null}
            </View>
            <View style={styles.pagerSlot}>
              {position < verses.length - 1 ? (
                <Button label="Next →" onPress={() => goTo(position + 1)} />
              ) : (
                <Button label="Done" onPress={() => router.back()} />
              )}
            </View>
          </View>
        </Column>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.three, paddingBottom: Spacing.six },
  body: { gap: Spacing.three },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 6 },
  question: { fontSize: 24, lineHeight: 34, fontWeight: '600' },
  meaning: { fontSize: 15, lineHeight: 24 },
  pager: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  pagerSlot: { flex: 1 },
  retryGap: { marginTop: Spacing.three },
});
