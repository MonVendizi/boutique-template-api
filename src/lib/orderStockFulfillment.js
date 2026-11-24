/**
 * Garde d'idempotence fulfillment :
 * si une commande existe déjà pour cette session / PaymentIntent Stripe,
 * on ne retouche pas le stock (évite double décrement sur webhook rejoué).
 */
export function shouldSkipStockBecauseOrderExists(existingRows) {
  return Array.isArray(existingRows) && existingRows.length > 0;
}
