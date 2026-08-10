import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AudioBar } from '@/components/audio-bar';
import { LanguageToggle } from '@/components/language-toggle';
import { PhraseReveal } from '@/components/phrase-reveal';
import { RecordingBar } from '@/components/recording-bar';
import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Centered, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { verseAudioUri } from '@/lib/audio-cache';
import { useContent } from '@/lib/content';
import { loadSession, usePractice } from '@/lib/practice';
import type { Grade } from '@/lib/scheduler';
import { verseAudio, verseChunks, verseQuestion, verseReference, type Verse } from '@/lib/types';

/**
 * Today's practice session.
 *
 * The loop is: prompt → try to recall → reveal → say how it went. Reveal is
 * phrase-at-a-time using the source's own `*_chunks` boundaries, because
 * dumping the whole answer at once turns recall into recognition — the
 * learner sees the text and feels like they knew it.
 *
 * The queue is captured once when the session starts rather than recomputed
 * after each grade: a queue that reshuffled underneath the learner would be
 * disorienting, and a verse graded "again" needs to come back *after* the
 * others, not immediately.
 */
export default function PracticeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { language } = useContent();
  const { ready, goals, grade, today, error, pending } = usePractice();

  const [queue, setQueue] = useState<Verse[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [graded, setGraded] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      setLoadError(null);
      try {
        const session = await loadSession(today, goals);
        if (cancelled) return;
        // Due reviews before new material: a verse the learner is about to
        // forget is worth more than one they've never seen.
        setQueue([...session.due, ...session.fresh]);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't build today's session");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately not re-running on `revision` — grading must not rebuild
    // the queue mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, attempt]);

  const verse = queue?.[position] ?? null;
  const chunks = useMemo(
    () => (verse ? verseChunks(verse, language) : []),
    [language, verse],
  );

  const onGrade = useCallback(
    async (value: Grade) => {
      if (!verse) return;
      await grade(verse.id, value);
      setGraded((count) => count + 1);
      // "Again" means it comes back before the session ends — appended to the
      // tail rather than shown twice in a row, so the learner isn't just
      // reading back the answer still on screen. Grading it "again" again
      // simply appends it again; it leaves the queue when it's recalled.
      if (value === 'again') setQueue((current) => [...(current ?? []), verse]);
      setRevealed(0);
      setPosition((index) => index + 1);
    },
    [grade, verse],
  );

  if (loadError) {
    return (
      <Centered>
        <Banner tone="error">{loadError}</Banner>
        <View style={styles.retryGap}>
          <Button label="Try again" onPress={() => setAttempt((count) => count + 1)} />
        </View>
      </Centered>
    );
  }

  if (!ready || !queue) return <Loading label="Building today's session…" />;

  if (position >= queue.length) {
    return (
      <>
        <Stack.Screen options={{ title: 'Practice' }} />
        <Centered>
          <ThemedText type="default" style={styles.doneTitle}>
            {graded > 0 ? "That's today done" : 'Nothing due today'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.doneBody}>
            {graded > 0
              ? `${graded} ${graded === 1 ? 'review' : 'reviews'} recorded.${
                  pending > 0 ? ` ${pending} still to sync.` : ''
                }`
              : 'Everything you’ve started is scheduled for a later day. Set a goal to pull more new verses in.'}
          </ThemedText>
          <Button label="Practise anyway" variant="secondary" onPress={() => router.replace('/free-practice')} />
          <View style={styles.retryGap}>
            <Button label="Back to library" onPress={() => router.replace('/')} />
          </View>
        </Centered>
      </>
    );
  }

  // Unreachable given the bound check above; here so the rest of the render
  // can treat the verse as present.
  if (!verse) return <Loading />;

  const question = verseQuestion(verse, language);
  const reference = verseReference(verse, language);
  const rawAudioUrl = verseAudio(verse, language);
  const audioUrl = rawAudioUrl
    ? verseAudioUri(verse.id, language === 'english' ? 'en' : 'gu', rawAudioUrl)
    : null;
  const fullyRevealed = revealed >= chunks.length;

  return (
    <>
      <Stack.Screen options={{ title: `${position + 1} of ${queue.length}` }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Column style={styles.body}>
          {error ? <Banner tone="error">{error}</Banner> : null}

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

          {/*
            The prompt. For the 40 verses with no shlok the question is the
            only thing that can be asked; for Satsang Diksha it's the framing
            and the shlok below is the material.
          */}
          <ThemedText style={styles.question}>{question || 'Recite this verse'}</ThemedText>

          <LanguageToggle />

          <PhraseReveal
            chunks={chunks}
            revealed={revealed}
            onReveal={() => setRevealed((count) => count + 1)}
            onRevealAll={() => setRevealed(chunks.length)}
            keyPrefix={verse.id}
          />

          {/*
            Audio and grading only after the answer is up. Offering "easy"
            before revealing would let a session be tapped through without
            ever checking the recall against the text.
          */}
          {fullyRevealed ? (
            <>
              {audioUrl ? (
                <AudioBar
                  key={audioUrl}
                  url={audioUrl}
                  label={language === 'english' ? 'English explanation' : 'Recitation'}
                />
              ) : null}

              <RecordingBar key={verse.id} verseId={verse.id} />

              <View style={styles.gradeBlock}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  How did that go?
                </ThemedText>
                <View style={styles.grades}>
                  <View style={styles.gradeSlot}>
                    <Button variant="secondary" label="Again" onPress={() => onGrade('again')} />
                  </View>
                  <View style={styles.gradeSlot}>
                    <Button variant="secondary" label="Hard" onPress={() => onGrade('hard')} />
                  </View>
                  <View style={styles.gradeSlot}>
                    <Button label="Easy" onPress={() => onGrade('easy')} />
                  </View>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Again brings it back before you finish today.
                </ThemedText>
              </View>
            </>
          ) : null}
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
  gradeBlock: { gap: Spacing.two },
  grades: { flexDirection: 'row', gap: Spacing.two },
  gradeSlot: { flex: 1 },
  doneTitle: { fontWeight: '600' },
  doneBody: { textAlign: 'center', marginVertical: Spacing.two },
  retryGap: { marginTop: Spacing.three },
});
