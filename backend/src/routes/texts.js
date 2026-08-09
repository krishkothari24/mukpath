import { pool } from "../db.js";

export default async function textsRoutes(fastify) {
  fastify.get("/texts", async (request, reply) => {
    const { rows } = await pool.query(
      "SELECT id, name, description FROM texts ORDER BY name",
    );
    return rows;
  });

  fastify.get("/texts/:id/verses", async (request, reply) => {
    const { id } = request.params;

    const textRes = await pool.query("SELECT id FROM texts WHERE id = $1", [id]);
    if (textRes.rowCount === 0) {
      return reply.code(404).send({ error: "text not found" });
    }

    const { rows } = await pool.query(
      `SELECT
         v.id, v.sanskrit, v.transliteration, v.meaning, v.audio_url,
         v.question, v.question_transliteration, v.question_gujarati,
         v.reference, v.reference_gujarati, v.audio_url_english, v.has_shlok,
         v.sanskrit_chunks, v.transliteration_chunks, v.meaning_chunks,
         v.order_index AS verse_order,
         s.id AS section_id, s.name AS section_name, s.order_index AS section_order
       FROM verses v
       JOIN sections s ON s.id = v.section_id
       WHERE s.text_id = $1
       ORDER BY s.order_index, v.order_index`,
      [id],
    );
    return rows;
  });
}
