# Seed review

Source: https://bkymukhpath.nahq.baps.dev/data.json

- texts: 5
- sections: 5
- verses: 50 (10 carry an actual shlok)
- with audio: 50

## Decisions worth a second look

- **Sections are placeholders.** The source has no level between
  text and verse, so each text gets one section named after it.
  If you want Satsang Diksha split by shlok range, that's a manual
  pass or a rule based on `reference`.
- **Only Satsang Diksha has a `shlok`.** For the other four texts
  the memorised material is the *answer*, so `sanskrit` /
  `transliteration` hold the Gujarati and lipi answers. `has_shlok`
  marks which is which.
- **Extra fields beyond the CLAUDE.md schema** are kept rather than
  dropped: `question*`, `reference*`, `audio_url_english`,
  `has_shlok`. This content is question/answer shaped and the
  question is what a learner is prompted with — losing it would
  gut the practice screen. Decide whether `verses` grows these
  columns or they move to their own table.
- **`*_chunks` preserve the source's `{{$$}}` phrase boundaries.**
  The web app splits on them and has repeat-playback controls, so
  they most likely mark the phrase-at-a-time practice units. Worth
  confirming against the audio before building the practice screen
  on top of them — they may not be timestamp-aligned.
- **`audio_url` is the Gujarati recitation**; the English
  explanation track is `audio_url_english`. Both are absolute URLs
  on bkymukhpath.nahq.baps.dev — mirror them before shipping if you
  don't want a runtime dependency on that host.

## Flagged records

- `Vachanamrut` #7 (vachnamrut-7): 4 Gujarati phrase(s) vs 5 transliteration — they can't be shown side by side until this is reconciled
- `Swamini Vato` #7 (swami-ni-vato-7): 5 Gujarati phrase(s) vs 6 transliteration — they can't be shown side by side until this is reconciled
- `Swamini Vato` #10 (swami-ni-vato-10): 10 Gujarati phrase(s) vs 9 transliteration — they can't be shown side by side until this is reconciled
