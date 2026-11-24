/**
 * Stock variantes (options JSONB dans product_variants).
 * Idempotent côté schéma : colonnes ajoutées via ensureVariantStockSchema.
 */

export function optionLabel(type, option) {
  if (!option || typeof option !== "object") return "";
  if (type === "size_color") {
    return `${option.size || ""} / ${option.color || ""}`.trim();
  }
  if (type === "custom" && option.attribute) {
    return `${option.attribute}: ${option.name || ""}`;
  }
  return String(option.name || option.size || "");
}

export function findOptionIndex(options, type, label) {
  if (!Array.isArray(options) || !label) return -1;
  const wanted = String(label).trim();
  return options.findIndex((opt) => optionLabel(type, opt) === wanted);
}

/** Applique un delta sur le stock d'une option (immuable). */
export function applyOptionStockDelta(options, type, label, delta) {
  const next = Array.isArray(options) ? options.map((o) => ({ ...o })) : [];
  const idx = findOptionIndex(next, type, label);
  if (idx < 0) {
    const err = new Error(`Variante introuvable : ${label}`);
    err.code = "VARIANT_NOT_FOUND";
    throw err;
  }
  const current = Number(next[idx].stock) || 0;
  const updated = current + Number(delta);
  if (updated < 0) {
    const err = new Error(
      `Stock insuffisant pour la variante « ${label} » (disponible : ${current})`,
    );
    err.code = "OUT_OF_STOCK";
    err.available = current;
    err.label = label;
    throw err;
  }
  next[idx] = { ...next[idx], stock: updated };
  return next;
}

/**
 * Vérifie le stock produit (+ variante si présente) pour une ligne panier.
 * items: { product_id, quantity, slug?, name?, variant?: { type?, label? } }[]
 */
export async function assertItemsHaveStock(client, items) {
  for (const item of items) {
    const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
    if (qty < 1) {
      const err = new Error("Quantité invalide");
      err.code = "INVALID_QTY";
      throw err;
    }

    const { rows: products } = await client.query(
      `SELECT id, name, slug, stock, has_variants, variant_type
       FROM products WHERE id = $1 FOR UPDATE`,
      [item.product_id],
    );
    if (!products.length) {
      const err = new Error(`Produit ${item.product_id} introuvable`);
      err.code = "PRODUCT_NOT_FOUND";
      throw err;
    }
    const product = products[0];
    const displayName = item.name || product.name || product.slug;

    if (product.has_variants) {
      const label = item.variant?.label;
      if (!label) {
        const err = new Error(
          `Veuillez choisir une variante pour « ${displayName} »`,
        );
        err.code = "VARIANT_REQUIRED";
        throw err;
      }

      const { rows: vrows } = await client.query(
        `SELECT type, options FROM product_variants WHERE product_id = $1 FOR UPDATE`,
        [product.id],
      );
      if (!vrows.length) {
        const err = new Error(
          `Variantes introuvables pour « ${displayName} »`,
        );
        err.code = "VARIANT_NOT_FOUND";
        throw err;
      }
      const type = item.variant?.type || vrows[0].type || product.variant_type || "size";
      const options = Array.isArray(vrows[0].options) ? vrows[0].options : [];
      const idx = findOptionIndex(options, type, label);
      if (idx < 0) {
        const err = new Error(
          `Variante « ${label} » introuvable pour « ${displayName} »`,
        );
        err.code = "VARIANT_NOT_FOUND";
        throw err;
      }
      const available = Number(options[idx].stock) || 0;
      if (available < qty) {
        const err = new Error(
          `Stock insuffisant pour « ${displayName} » (${label}) — disponible : ${available}`,
        );
        err.code = "OUT_OF_STOCK";
        err.available = available;
        err.slug = product.slug;
        err.label = label;
        throw err;
      }
    } else if (Number(product.stock) < qty) {
      const err = new Error(
        `Stock insuffisant pour « ${displayName} » — disponible : ${product.stock}`,
      );
      err.code = "OUT_OF_STOCK";
      err.available = product.stock;
      err.slug = product.slug;
      throw err;
    }
  }
}

/**
 * Décrémente stock produit + stock variante (si présente) + mouvements.
 * À appeler après assertItemsHaveStock, dans la même transaction.
 * products.stock utilise GREATEST(0, …) pour ne pas casser les catalogues
 * où le stock produit n'était pas aligné sur les variantes.
 */
export async function decrementItemsStock(client, orderId, items) {
  for (const item of items) {
    const qty = Math.max(0, Math.round(Number(item.quantity) || 0));

    await client.query(
      "UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2",
      [qty, item.product_id],
    );

    const label = item.variant?.label || null;
    await client.query(
      `INSERT INTO stock_movements (product_id, order_id, quantity_change, reason, variant_label)
       VALUES ($1, $2, $3, 'order', $4)`,
      [item.product_id, orderId, -qty, label],
    );

    const { rows: products } = await client.query(
      `SELECT has_variants, variant_type FROM products WHERE id = $1`,
      [item.product_id],
    );
    if (!products[0]?.has_variants || !label) continue;

    const { rows: vrows } = await client.query(
      `SELECT type, options FROM product_variants WHERE product_id = $1 FOR UPDATE`,
      [item.product_id],
    );
    if (!vrows.length) {
      const err = new Error(
        `Variantes introuvables pour le produit ${item.product_id}`,
      );
      err.code = "VARIANT_NOT_FOUND";
      throw err;
    }

    const type =
      item.variant?.type || vrows[0].type || products[0].variant_type || "size";
    const options = Array.isArray(vrows[0].options) ? vrows[0].options : [];
    const next = applyOptionStockDelta(options, type, label, -qty);

    await client.query(
      `UPDATE product_variants SET options = $1::jsonb WHERE product_id = $2`,
      [JSON.stringify(next), item.product_id],
    );
  }
}

/** Migration idempotente (pas de perte de données). */
export async function ensureVariantStockSchema(poolOrClient) {
  await poolOrClient.query(`
    ALTER TABLE stock_movements
      ADD COLUMN IF NOT EXISTS variant_label VARCHAR(255)
  `);
}
