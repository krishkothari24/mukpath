import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AudioBar } from '@/components/audio-bar';
import { LanguageToggle } from '@/components/language-toggle';
import { RecordingBar } from '@/components/recording-bar';
import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Centered, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { verseAudioUri } from '@/lib/audio-cache';
import { useContent } from '@/lib/content';
import { getVerse, listVerses } from '@/lib/db';
import {
  verseAudio,
  verseChunks,
  verseQuestion,
  verseReference,
  type Verse,
} from '@/lib/types';

export default function VerseScreen() {
  const { verseId } = useLocalSearchParams<{ verseId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { ready, revision, language } = useContent();

  const [verse, setVerse] = useState<Verse | null>(null);
  const [siblings, setSiblings] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready || !verseId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await getVerse(verseId);
        if (cancelled) return;
        setVerse(row);
        setSiblings(row ? await listVerses(row.section_id) : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this verse');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, revision, verseId, attempt]);

  const { index, previous, next } = useMemo(() => {
    const position = siblings.findIndex((item) => item.id === verseId);
    return {
      index: position,
      previous: position > 0 ? siblings[position - 1] : null,
      next: position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null,
    };
  }, [siblings, verseId]);

  if (loading) return <Loading />;

  if (error) {
    return (
      <Centered>
        <Banner tone="error">{error}</Banner>
        <View style={styles.retry}>
          <Button label="Try again" onPress={() => setAttempt((count) => count + 1)} />
        </View>
      </Centered>
    );
  }

  if (!verse) {
    return (
      <Centered>
        <ThemedText type="default">That verse isn&apos;t on this device.</ThemedText>
      </Centered>
    );
  }

  const question = verseQuestion(verse, language);
  const reference = verseReference(verse, language);
  const chunks = verseChunks(verse, language);
  const rawAudioUrl = verseAudio(verse, language);
  const audioUrl = rawAudioUrl
    ? verseAudioUri(verse.id, language === 'english' ? 'en' : 'gu', rawAudioUrl)
    : null;
  // When reading Gujarati or Lipi, the English is a comprehension aid rather
  // than the material — show it, but secondary.
  const showMeaningAid = language !== 'english' && Boolean(verse.meaning);

  return (
    <>
      <Stack.Screen
        options={{ title: index >= 0 ? `${index + 1} of ${siblings.length}` : 'Verse' }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Column style={styles.body}>
          <View style={styles.heading}>
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

            {question ? <ThemedText style={styles.question}>{question}</ThemedText> : null}
          </View>

          <LanguageToggle />

          {/*
            The material to memorise. For Satsang Diksha this is the shlok;
            for the other four texts it is the answer to the question above.
            Rendered phrase-by-phrase using the source's own boundaries, which
            is the unit Phase 3's practice screen will reveal one at a time.
          */}
          <Card>
            {chunks.length ? (
              chunks.map((chunk, chunkIndex) => (
                <ThemedText key={`${verse.id}-${chunkIndex}`} style={styles.verseLine}>
                  {chunk}
                </ThemedText>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing recorded for this script.
              </ThemedText>
            )}
          </Card>

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
              // Remounts when the track changes, which is how the source swaps.
              key={audioUrl}
              url={audioUrl}
              label={language === 'english' ? 'English explanation' : 'Recitation'}
            />
          ) : null}

          <RecordingBar key={verse.id} verseId={verse.id} />

          <View style={styles.pager}>
            <View style={styles.pagerSlot}>
              {previous ? (
                <Button
                  variant="secondary"
                  label="← Previous"
                  onPress={() => router.replace(`/verse/${previous.id}`)}
                />
              ) : null}
            </View>
            <View style={styles.pagerSlot}>
              {next ? (
                <Button
                  variant="secondary"
                  label="Next →"
                  onPress={() => router.replace(`/verse/${next.id}`)}
                />
              ) : null}
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
  heading: { gap: Spacing.two },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 6 },
  question: { fontSize: 24, lineHeight: 34, fontWeight: '600' },
  // Gujarati script needs noticeably more leading than Latin at the same size.
  verseLine: { fontSize: 20, lineHeight: 34 },
  meaning: { fontSize: 15, lineHeight: 24 },
  pager: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  pagerSlot: { flex: 1 },
  retry: { marginTop: Spacing.three },
});
