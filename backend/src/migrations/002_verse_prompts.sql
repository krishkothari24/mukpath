-- The verses table in CLAUDE.md was written before we knew what the
-- content actually looked like. The real source (the NC27 web app) is
-- question/answer shaped: 40 of the 50 verses carry no shlok at all, and
-- for those the *question* is the only thing a learner can be prompted
-- with. Storing just sanskrit/transliteration/meaning meant the practice
-- screen would have nothing to ask.
--
-- All nullable, so nothing that already loaded breaks.

ALTER TABLE verses
  ADD COLUMN question                 TEXT,
  ADD COLUMN question_transliteration TEXT,
  ADD COLUMN question_gujarati        TEXT,
  -- Where the material comes from, e.g. "Shlok 96" / "શ્લોક ૯૬".
  ADD COLUMN reference                TEXT,
  ADD COLUMN reference_gujarati       TEXT,
  -- The Gujarati recitation lives in audio_url; this is the English
  -- explanation track, a separate recording.
  ADD COLUMN audio_url_english        TEXT,
  -- True only for Satsang Diksha, where sanskrit/transliteration hold an
  -- actual shlok rather than the answer text.
  ADD COLUMN has_shlok                BOOLEAN NOT NULL DEFAULT FALSE,
  -- Phrase boundaries from the source's {{$$}} markers, kept as ordered
  -- arrays for phrase-at-a-time playback and recall in Phase 3/5.
  ADD COLUMN sanskrit_chunks          JSONB,
  ADD COLUMN transliteration_chunks   JSONB,
  ADD COLUMN meaning_chunks           JSONB;
