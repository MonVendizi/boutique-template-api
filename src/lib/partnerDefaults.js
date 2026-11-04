/** Programme partenaire Vendizi — modèle unique. */

export const DEFAULT_PARTNER_JOURX_URL =
  process.env.PARTNER_JOURX_URL || "https://jourx.fr";

export const DEFAULT_PARTNER_SECONDARY_URL =
  process.env.PARTNER_SECONDARY_URL || "https://tinaluxe.fr";

export const DEFAULT_PARTNER_SECONDARY_NAME =
  process.env.PARTNER_SECONDARY_NAME || "TinaLuxe";

/** Remise fixe quand le programme est actif (−5 €/mois). */
export const PARTNER_PROGRAM_DISCOUNT = Number(
  process.env.PARTNER_PROGRAM_DISCOUNT || 5,
);

/** Emplacement unique : confirmation commande + page 404. */
export const PARTNER_PROGRAM_PLACEMENT = "all";

/** @deprecated Conservé pour compat lecture ; toujours "all". */
export const PARTNER_PLACEMENTS = ["all"];

/**
 * Tout placement legacy → confirmation + 404.
 */
export function normalizePartnerPlacement(_value) {
  return PARTNER_PROGRAM_PLACEMENT;
}

/**
 * Programme actif si au moins un partenaire l’était (migration),
 * ou si les deux sont ON.
 */
export function isPartnerProgramEnabled(config = {}) {
  return (
    config.partner_jourx_enabled === "true" ||
    config.partner_tinaluxe_enabled === "true" ||
    config.partner_secondary_enabled === "true"
  );
}

/**
 * Payload canonique à persister : les 2 partenaires, placement all, −5 €.
 */
export function partnerProgramState(enabled) {
  const on = Boolean(enabled);
  return {
    partner_jourx_enabled: String(on),
    partner_tinaluxe_enabled: String(on),
    partner_secondary_enabled: String(on),
    partner_jourx_placement: PARTNER_PROGRAM_PLACEMENT,
    partner_tinaluxe_placement: PARTNER_PROGRAM_PLACEMENT,
    partner_secondary_placement: PARTNER_PROGRAM_PLACEMENT,
    partner_discount_amount: String(on ? PARTNER_PROGRAM_DISCOUNT : 0),
  };
}
