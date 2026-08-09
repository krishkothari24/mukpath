import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Centered, Column, ListRow, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useContent } from '@/lib/content';
import { getText, listSections, verseCountsBySection } from '@/lib/db';
import type { Section, Text as TextRow } from '@/lib/types';

/**
 * Sections within a text.
 *
 * Today every text has exactly one section named after the text itself — the
 * NC27 source has no level between text and verse, so `fetch_webapp.py` emits
 * a single placeholder per text. The screen exists because that is expected to
 * change (splitting Satsang Diksha by shlok range is a known want) and the
 * data model already carries `section_id`.
 */
export default function SectionsScreen() {
  const { textId } = useLocalSearchParams<{ textId: string }>();
  const router = useRouter();
  const { ready, revision } = useContent();

  const [text, setText] = useState<TextRow | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !textId) return;
    let cancelled = false;

    (async () => {
      const [textRow, sectionRows, verseCounts] = await Promise.all([
        getText(textId),
        listSections(textId),
        verseCountsBySection(textId),
      ]);
      if (cancelled) return;
      setText(textRow);
      setSections(sectionRows);
      setCounts(verseCounts);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, revision, textId]);

  if (loading) return <Loading />;

  if (!text) {
    return (
      <Centered>
        <ThemedText type="default">That text isn&apos;t on this device.</ThemedText>
      </Centered>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: text.name }} />
      <FlatList
        data={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          text.description ? (
            <Column style={styles.intro}>
              <ThemedText type="small" themeColor="textSecondary">
                {text.description}
              </ThemedText>
            </Column>
          ) : null
        }
        renderItem={({ item }) => (
          <Column>
            <ListRow
              title={item.name}
              meta={counts[item.id] ? `${counts[item.id]} verses` : null}
              onPress={() => router.push(`/section/${item.id}`)}
            />
          </Column>
        )}
        ListEmptyComponent={
          <Centered>
            <ThemedText type="small" themeColor="textSecondary">
              No sections in this text yet.
            </ThemedText>
          </Centered>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.five },
  intro: { paddingVertical: Spacing.three },
});
