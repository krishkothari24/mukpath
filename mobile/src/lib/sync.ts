import { api } from '@/lib/api';
import { getPref, replaceContent, setPref } from '@/lib/db';
import type { Section, Text, Verse } from '@/lib/types';

export const LAST_SYNC_KEY = 'content.last_sync';

export type SyncResult = {
  texts: number;
  sections: number;
  verses: number;
  syncedAt: string;
};

/**
 * Pull the entire corpus into SQLite.
 *
 * Six requests total (one for the text list, one per text) because the whole
 * thing is ~130KB. There is no incremental sync and no `updated_at` on the
 * server to build one from; when the content grows enough to need one, that's
 * a backend change first.
 *
 * The backend has no /sections endpoint — sections come back joined onto each
 * verse row, so we reconstruct the section list here by de-duplicating.
 */
export async function syncContent(): Promise<SyncResult> {
  const texts: Text[] = await api.texts();

  const sectionsById = new Map<string, Section>();
  const verses: Verse[] = [];

  for (const text of texts) {
    const rows = await api.verses(text.id);
    for (const row of rows) {
      if (!sectionsById.has(row.section_id)) {
        sectionsById.set(row.section_id, {
          id: row.section_id,
          text_id: text.id,
          name: row.section_name,
          order_index: row.section_order,
        });
      }

      verses.push({
        id: row.id,
        section_id: row.section_id,
        text_id: text.id,
        sanskrit: row.sanskrit,
        transliteration: row.transliteration,
        meaning: row.meaning,
        audio_url: row.audio_url,
        audio_url_english: row.audio_url_english,
        question: row.question,
        question_transliteration: row.question_transliteration,
        question_gujarati: row.question_gujarati,
        reference: row.reference,
        reference_gujarati: row.reference_gujarati,
        has_shlok: Boolean(row.has_shlok),
        sanskrit_chunks: row.sanskrit_chunks ?? [],
        transliteration_chunks: row.transliteration_chunks ?? [],
        meaning_chunks: row.meaning_chunks ?? [],
        order_index: row.verse_order,
      });
    }
  }

  const sections = [...sectionsById.values()];
  await replaceContent(texts, sections, verses);

  const syncedAt = new Date().toISOString();
  await setPref(LAST_SYNC_KEY, syncedAt);

  return { texts: texts.length, sections: sections.length, verses: verses.length, syncedAt };
}

export async function lastSyncedAt(): Promise<Date | null> {
  const raw = await getPref(LAST_SYNC_KEY);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
