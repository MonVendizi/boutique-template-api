export async function getCrossSellSuggestions(purchasedSlugs, pool) {
  const slugs = Array.isArray(purchasedSlugs) ? purchasedSlugs.filter(Boolean) : [];

  const result = await pool.query(
    `
    SELECT slug, name, price_cents, images
    FROM products
    WHERE active = true
    AND slug != ALL($1)
    ORDER BY sort_order ASC
    LIMIT 2
  `,
    [slugs.length ? slugs : [""]]
  );

  return result.rows.map((p) => ({
    name: p.name,
    slug: p.slug,
    price: (p.price_cents / 100).toFixed(2),
    reason: "Nos clientes qui ont acheté ce produit adorent aussi celui-ci",
  }));
}
