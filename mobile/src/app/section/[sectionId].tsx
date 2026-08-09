import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { LanguageToggle } from '@/components/language-toggle';
import { ThemedText } from '@/components/themed-text';
import { Centered, Column, ListRow, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useContent } from '@/lib/content';
import { getSection, listVerses } from '@/lib/db';
import { verseBody, verseQuestion, verseReference, type Section, type Verse } from '@/lib/types';

/** One line of preview text, whitespace collapsed. */
function snippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export default function VersesScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  const router = useRouter();
  const { ready, revision, language } = useContent();

  const [section, setSection] = useState<Section | null>(null);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !sectionId) return;
    let cancelled = false;

    (async () => {
      const [sectionRow, verseRows] = await Promise.all([
        getSection(sectionId),
        listVerses(sectionId),
      ]);
      if (cancelled) return;
      setSection(sectionRow);
      setVerses(verseRows);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, revision, sectionId]);

  if (loading) return <Loading />;

  if (!section) {
    return (
      <Centered>
        <ThemedText type="default">That section isn&apos;t on this device.</ThemedText>
      </Centered>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: section.name }} />
      <FlatList
        data={verses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Column style={styles.header}>
            <LanguageToggle />
          </Column>
        }
        renderItem={({ item, index }) => {
          // The question is the natural label — for the 40 verses with no
          // shlok it is the only thing distinguishing one from the next. Where
          // it is missing, fall back to the opening words of the verse itself.
          const question = verseQuestion(item, language);
          const body = snippet(verseBody(item, language));
          const title = question || body || `Verse ${index + 1}`;
          const subtitle = question ? body : null;

          return (
            <Column>
              <ListRow
                title={`${index + 1}. ${title}`}
                subtitle={subtitle}
                meta={verseReference(item, language) || null}
                onPress={() => router.push(`/verse/${item.id}`)}
              />
            </Column>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">
              No verses in this section yet.
            </ThemedText>
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.five },
  header: { paddingVertical: Spacing.three },
  empty: { padding: Spacing.four, alignItems: 'center' },
});
