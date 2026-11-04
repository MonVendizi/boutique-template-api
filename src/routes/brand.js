import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";
import { notifyIndexNow } from "../lib/indexnow.js";
import {
  DEFAULT_PARTNER_JOURX_URL,
  DEFAULT_PARTNER_SECONDARY_NAME,
  DEFAULT_PARTNER_SECONDARY_URL,
  normalizePartnerPlacement,
} from "../lib/partnerDefaults.js";

export default async function brandRoutes(fastify) {
  fastify.get("/indexnow-key", async (request, reply) => {
    const key = process.env.INDEXNOW_KEY || "";
    if (!key) {
      return reply.code(404).send({ error: "IndexNow non configuré" });
    }
    return { key };
  });
  /** Config publique programme partenaire (bannières + grille réductions) */
  fastify.get("/partner-config", async () => {
    const { rows } = await pool.query(`
      SELECT key, value FROM brand_settings
      WHERE category = 'partner'
         OR key IN ('partner_jourx_url', 'partner_secondary_url', 'partner_secondary_name')
    `);
    const config = {};
    for (const row of rows) config[row.key] = row.value;

    const defaults = {
      jourx_confirmation_discount: "10",
      jourx_not_found_discount: "5",
      jourx_all_discount: "12",
      tinaluxe_confirmation_discount: "15",
      tinaluxe_not_found_discount: "5",
      tinaluxe_all_discount: "18",
      // legacy keys (ignorées côté affichage panier)
      jourx_cart_discount: "10",
      tinaluxe_cart_discount: "15",
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (config[key] === undefined || config[key] === null || config[key] === "") {
        config[key] = value;
      }
    }
    const pairs = [
      ["partner_tinaluxe_enabled", "partner_secondary_enabled"],
      ["partner_tinaluxe_placement", "partner_secondary_placement"],
      ["tinaluxe_cart_discount", "secondary_cart_discount"],
      ["tinaluxe_confirmation_discount", "secondary_confirmation_discount"],
      ["tinaluxe_not_found_discount", "secondary_not_found_discount"],
      ["tinaluxe_all_discount", "secondary_all_discount"],
    ];
    for (const [from, to] of pairs) {
      if (config[to] === undefined || config[to] === null || config[to] === "") {
        config[to] = config[from] || "";
      }
    }

    // URLs auto si absentes (déploiement / boutiques existantes)
    const rawJourxUrl = String(config.partner_jourx_url || "").trim();
    const rawSecondaryUrl = String(config.partner_secondary_url || "").trim();
    const rawSecondaryName = String(config.partner_secondary_name || "").trim();
    config.partner_jourx_url = rawJourxUrl || DEFAULT_PARTNER_JOURX_URL;
    config.partner_secondary_url =
      rawSecondaryUrl || DEFAULT_PARTNER_SECONDARY_URL;
    config.partner_secondary_name =
      rawSecondaryName || DEFAULT_PARTNER_SECONDARY_NAME;

    // Placements : plus de panier — cart/legacy → confirmation
    const rawJourxPlacement = config.partner_jourx_placement;
    const rawTinaluxePlacement = config.partner_tinaluxe_placement;
    config.partner_jourx_placement = normalizePartnerPlacement(rawJourxPlacement);
    config.partner_tinaluxe_placement =
      normalizePartnerPlacement(rawTinaluxePlacement);
    config.partner_secondary_placement = normalizePartnerPlacement(
      config.partner_secondary_placement || config.partner_tinaluxe_placement,
    );

    // Persistance lazy (1ère lecture après déploiement) — URLs vides + cart→confirmation
    const heals = [];
    if (!rawJourxUrl) {
      heals.push(["partner_jourx_url", config.partner_jourx_url, "string", "partner", "URL destination pub JourX"]);
    }
    if (!rawSecondaryUrl) {
      heals.push([
        "partner_secondary_url",
        config.partner_secondary_url,
        "string",
        "partner",
        "URL destination pub partenaire secondaire",
      ]);
    }
    if (!rawSecondaryName) {
      heals.push([
        "partner_secondary_name",
        config.partner_secondary_name,
        "string",
        "partner",
        "Nom affiché partenaire secondaire",
      ]);
    }
    if (
      String(rawJourxPlacement || "") !== config.partner_jourx_placement
    ) {
      heals.push([
        "partner_jourx_placement",
        config.partner_jourx_placement,
        "string",
        "partner",
        "Placement pub JourX : confirmation | not_found | all",
      ]);
    }
    if (
      String(rawTinaluxePlacement || "") !== config.partner_tinaluxe_placement
    ) {
      heals.push([
        "partner_tinaluxe_placement",
        config.partner_tinaluxe_placement,
        "string",
        "partner",
        "Placement pub partenaire : confirmation | not_found | all",
      ]);
    }
    if (heals.length) {
      void Promise.all(
        heals.map(([key, value, type, category, label]) =>
          pool.query(
            `INSERT INTO brand_settings (key, value, type, category, label)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, value, type, category, label],
          ).catch(() => null),
        ),
      );
    }

    return config;
  });

  fastify.get("/brand/settings", async () => {
    const result = await pool.query(
      `SELECT key, value, type FROM brand_settings ORDER BY category, key`
    );
    const settings = {};
    for (const row of result.rows) {
      try {
        if (row.type === "json") {
          settings[row.key] = JSON.parse(row.value || "{}");
        } else if (row.type === "boolean") {
          settings[row.key] = row.value === "true";
        } else if (row.type === "number") {
          settings[row.key] = parseFloat(row.value) || 0;
        } else {
          settings[row.key] = row.value || "";
        }
      } catch {
        settings[row.key] = row.value || "";
      }
    }
    return settings;
  });

  fastify.get("/admin/brand/settings", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    const result = await pool.query(
      `SELECT * FROM brand_settings ORDER BY category, key`
    );
    return result.rows;
  });

  fastify.put("/admin/brand/settings", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    try {
      const updates = request.body;

      for (const [key, value] of Object.entries(updates)) {
        const strValue =
          typeof value === "object" ? JSON.stringify(value) : String(value);

        // Codes auto newsletter / inactifs : activer/désactiver le vrai code panier
        if (key === "welcome_promo_code" || key === "inactive_promo_code") {
          const prevRes = await pool.query(
            `SELECT value FROM brand_settings WHERE key = $1`,
            [key]
          );
          const prevCode = String(prevRes.rows[0]?.value || "").trim();
          const nextCode = strValue.trim();

          if (prevCode && prevCode.toUpperCase() !== nextCode.toUpperCase()) {
            await pool.query(
              `UPDATE promo_codes SET active = false WHERE UPPER(code) = UPPER($1)`,
              [prevCode]
            );
          }
          if (nextCode) {
            await pool.query(
              `UPDATE promo_codes SET active = true WHERE UPPER(code) = UPPER($1)`,
              [nextCode]
            );
          }
        }

        await pool.query(
          `
      INSERT INTO brand_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
          [key, strValue]
        );
      }

      void notifyIndexNow(["/"]);
      return { success: true };
    } catch (err) {
      console.error("Brand settings save error:", err);
      return reply.code(500).send({
        error: err.message || "Erreur sauvegarde brand settings",
      });
    }
  });
}
