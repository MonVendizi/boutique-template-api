/** URLs / placements partenaire — défauts déploiement & runtime. */

export const DEFAULT_PARTNER_JOURX_URL =
  process.env.PARTNER_JOURX_URL || "https://jourx.fr";

export const DEFAULT_PARTNER_SECONDARY_URL =
  process.env.PARTNER_SECONDARY_URL || "https://tinaluxe.fr";

export const DEFAULT_PARTNER_SECONDARY_NAME =
  process.env.PARTNER_SECONDARY_NAME || "TinaLuxe";

/** Emplacements autorisés (hors panier / paiement). */
export const PARTNER_PLACEMENTS = ["confirmation", "not_found", "all"];

/**
 * Normalise un placement legacy (cart, footer…) → confirmation | not_found | all
 */
export function normalizePartnerPlacement(value) {
  const v = String(value || "").trim();
  if (v === "all") return "all";
  if (v === "not_found") return "not_found";
  if (v === "confirmation") return "confirmation";
  return "confirmation";
}
