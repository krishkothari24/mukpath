// Loads Phase 0 output (seed/texts.json, sections.json, verses.json) into
// Postgres. Upserts by id so it's safe to re-run after hand-corrections.
//
//   npm run seed                       # loads ../seed/*.json
//   npm run seed -- --dir /path/to/dir # loads from elsewhere (e.g. a demo set)
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SEED_DIR = resolve(HERE, "../../seed");

function seedDirFromArgs(argv) {
  const i = argv.indexOf("--dir");
  return i === -1 ? DEFAULT_SEED_DIR : resolve(argv[i + 1]);
}

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const dir = seedDirFromArgs(process.argv.slice(2));
  const [texts, sections, verses] = await Promise.all([
    loadJson(join(dir, "texts.json")),
    loadJson(join(dir, "sections.json")),
    loadJson(join(dir, "verses.json")),
  ]);

  if (!texts || !sections || !verses) {
    console.error(
      `No seed data in ${dir} yet (texts.json/sections.json/verses.json).\n` +
      "Run `python3 scripts/fetch_webapp.py` from the repo root first — see docs/PHASE0.md.",
    );
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const t of texts) {
      await client.query(
        `INSERT INTO texts (id, name, description) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = $2, description = $3`,
        [t.id, t.name, t.description ?? ""],
      );
    }

    for (const s of sections) {
      await client.query(
        `INSERT INTO sections (id, text_id, name, order_index) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET text_id = $2, name = $3, order_index = $4`,
        [s.id, s.text_id, s.name, s.order],
      );
    }

    for (const v of verses) {
      await client.query(
        `INSERT INTO verses (
           id, section_id, sanskrit, transliteration, meaning, audio_url,
           order_index, question, question_transliteration, question_gujarati,
           reference, reference_gujarati, audio_url_english, has_shlok,
           sanskrit_chunks, transliteration_chunks, meaning_chunks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17)
         ON CONFLICT (id) DO UPDATE SET
           section_id = $2, sanskrit = $3, transliteration = $4,
           meaning = $5, audio_url = $6, order_index = $7,
           question = $8, question_transliteration = $9,
           question_gujarati = $10, reference = $11,
           reference_gujarati = $12, audio_url_english = $13,
           has_shlok = $14, sanskrit_chunks = $15,
           transliteration_chunks = $16, meaning_chunks = $17`,
        [
          v.id, v.section_id, v.sanskrit, v.transliteration, v.meaning,
          v.audio_url ?? null, v.order,
          v.question ?? null, v.question_lipi ?? null, v.question_gujarati ?? null,
          v.reference ?? null, v.reference_gujarati ?? null,
          v.audio_url_english ?? null, v.has_shlok ?? false,
          // JSONB params must be JSON text, not a JS array.
          JSON.stringify(v.sanskrit_chunks ?? []),
          JSON.stringify(v.transliteration_chunks ?? []),
          JSON.stringify(v.meaning_chunks ?? []),
        ],
      );
    }

    await client.query("COMMIT");
    console.log(`seeded ${texts.length} texts, ${sections.length} sections, ${verses.length} verses from ${dir}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
