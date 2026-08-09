// Shapes mirror the backend's responses (backend/src/routes/*.js) and the
// columns in backend/src/migrations. Field names are kept identical on
// purpose so sync is a straight copy rather than a mapping layer.

export type Text = {
  id: string;
  name: string;
  description: string | null;
};

export type Section = {
  id: string;
  text_id: string;
  name: string;
  order_index: number;
};

/**
 * One memorisable unit.
 *
 * Naming is inherited from CLAUDE.md's original schema and is misleading:
 * `sanskrit` holds **Gujarati script**, `transliteration` holds romanised
 * Gujarati, `meaning` holds English.
 *
 * `has_shlok` is true only for the 10 Satsang Diksha verses that carry an
 * actual shlok. For the other 40, the memorised material is the *answer* —
 * `sanskrit`/`transliteration`/`meaning` hold that answer, and `question`
 * is the prompt. The two cases render differently.
 */
export type Verse = {
  id: string;
  section_id: string;
  text_id: string;
  sanskrit: string | null;
  transliteration: string | null;
  meaning: string | null;
  audio_url: string | null;
  /** Separate recording: the English explanation, not a translation of the Gujarati track. */
  audio_url_english: string | null;
  question: string | null;
  question_transliteration: string | null;
  question_gujarati: string | null;
  /** e.g. "Shlok 96". Empty for texts that don't cite one. */
  reference: string | null;
  reference_gujarati: string | null;
  has_shlok: boolean;
  sanskrit_chunks: string[];
  transliteration_chunks: string[];
  meaning_chunks: string[];
  order_index: number;
};

/** A verse row as `GET /texts/:id/verses` returns it, with its section joined on. */
export type VerseApiRow = Omit<Verse, 'text_id' | 'order_index'> & {
  verse_order: number;
  section_name: string;
  section_order: number;
};

/**
 * One verse's schedule for the signed-in learner.
 *
 * Absence of a row means "never practised" — the app doesn't write `new` rows
 * ahead of time, so 50 untouched verses cost zero storage and the queue can
 * tell "not started" from "started and forgotten" without a flag.
 */
export type ProgressRow = {
  verse_id: string;
  status: 'new' | 'learning' | 'review' | 'mastered';
  next_review_date: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  /** The day this verse was first introduced — the daily new-verse budget. */
  started_on: string | null;
  last_reviewed_at: string | null;
};

/** A goal as the server returns it — `pace` is recomputed server-side on every read. */
export type Goal = {
  id: string;
  target_type: 'text' | 'section';
  target_id: string;
  target_name: string | null;
  text_id: string | null;
  target_date: string;
  total: number;
  started: number;
  mastered: number;
  pace: { remaining: number; daysLeft: number; perDay: number; behind: boolean };
};

export type User = {
  id: string;
  name: string;
  email?: string;
};

/**
 * Which script the learner reads. Every verse carries all three, and a kid
 * who can't read Gujarati script memorises off the transliteration — so this
 * is a real preference, not a display detail. Phase 3's practice screen will
 * read the same setting.
 */
export type Language = 'gujarati' | 'transliteration' | 'english';

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'gujarati', label: 'ગુજરાતી' },
  { value: 'transliteration', label: 'Lipi' },
  { value: 'english', label: 'English' },
];

/** The verse body to memorise, in the chosen script. */
export function verseBody(verse: Verse, language: Language): string {
  const body =
    language === 'gujarati'
      ? verse.sanskrit
      : language === 'transliteration'
        ? verse.transliteration
        : verse.meaning;
  return body ?? '';
}

/** The same body split on the source's phrase boundaries. */
export function verseChunks(verse: Verse, language: Language): string[] {
  const chunks =
    language === 'gujarati'
      ? verse.sanskrit_chunks
      : language === 'transliteration'
        ? verse.transliteration_chunks
        : verse.meaning_chunks;
  if (chunks?.length) return chunks;
  const body = verseBody(verse, language);
  return body ? body.split(/\n{2,}/).filter(Boolean) : [];
}

/** The prompt shown above the body, in the chosen script. */
export function verseQuestion(verse: Verse, language: Language): string {
  const question =
    language === 'gujarati'
      ? verse.question_gujarati
      : language === 'transliteration'
        ? verse.question_transliteration
        : verse.question;
  return question ?? verse.question ?? '';
}

export function verseReference(verse: Verse, language: Language): string {
  const reference = language === 'gujarati' ? verse.reference_gujarati : verse.reference;
  return reference ?? '';
}

/** Gujarati and Lipi share the Gujarati recitation; English has its own track. */
export function verseAudio(verse: Verse, language: Language): string | null {
  return language === 'english' ? (verse.audio_url_english ?? verse.audio_url) : verse.audio_url;
}
