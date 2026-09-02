import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

const EXISTING_REVIEWS = [
  {
    product_slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
    customer_name: "Nathalie M.",
    customer_email: "nathalie@import.fr",
    rating: 5,
    title: "Incroyable pour ma peau sèche",
    content:
      "Je l'utilise depuis 3 semaines et ma peau n'a jamais été aussi douce. Le karité de TinaLuxe est vraiment d'une qualité supérieure, on sent que c'est du vrai produit naturel.",
    status: "published",
    verified_purchase: false,
    created_at: "2026-03-15",
    published_at: "2026-03-15",
  },
  {
    product_slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
    customer_name: "Fatoumata D.",
    customer_email: "fatoumata@import.fr",
    rating: 5,
    title: "Le meilleur karité que j'ai testé",
    content:
      "Originaire du Cameroun, je suis très exigeante sur le karité. Celui de TinaLuxe est exactement comme celui que ma grand-mère préparait. Authentique, pur, efficace.",
    status: "published",
    verified_purchase: false,
    created_at: "2026-04-02",
    published_at: "2026-04-02",
  },
  {
    product_slug: "the-minceur-naturel-africain-infusion-bien-etre-detox",
    customer_name: "Aïcha B.",
    customer_email: "aicha@import.fr",
    rating: 5,
    title: "Résultats visibles en 2 semaines",
    content:
      "Je bois 2 tasses par jour depuis 2 semaines et je me sens vraiment plus légère. Le goût est agréable, pas amer du tout. Je recommande !",
    status: "published",
    verified_purchase: false,
    created_at: "2026-02-28",
    published_at: "2026-02-28",
  },
  {
    product_slug: "the-minceur-naturel-africain-infusion-bien-etre-detox",
    customer_name: "Mélanie R.",
    customer_email: "melanie@import.fr",
    rating: 5,
    title: "Mon rituel bien-être quotidien",
    content:
      "Ce thé est devenu mon rituel du matin. Légèreté digestive, ventre plat, goût fruité naturel. Je suis conquise et j'en ai déjà commandé un 2ème pot.",
    status: "published",
    verified_purchase: false,
    created_at: "2026-03-20",
    published_at: "2026-03-20",
  },
  {
    product_slug: "savon-tinaluxe-nicotinamide-lait-de-chevre",
    customer_name: "Sophie K.",
    customer_email: "sophie@import.fr",
    rating: 5,
    title: "Peau douce comme jamais",
    content:
      "Ce savon est une révélation. Ma peau est douce, lumineuse, sans tiraillement. Je ne reviendrai jamais aux savons du supermarché.",
    status: "published",
    verified_purchase: false,
    created_at: "2026-04-10",
    published_at: "2026-04-10",
  },
  {
    product_slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
    customer_name: "Isabelle T.",
    customer_email: "isabelle@import.fr",
    rating: 5,
    title: "Texture divine",
    content:
      "La texture est incroyable — légère comme une mousse mais ultra-nourrissante. Mon corps adore et il reste hydraté toute la journée.",
    status: "published",
    verified_purchase: false,
    created_at: "2026-05-03",
    published_at: "2026-05-03",
  },
];

async function importReviews() {
  console.log("Import avis…");
  let inserted = 0;

  for (const r of EXISTING_REVIEWS) {
    const { rows: products } = await pool.query(
      `SELECT id FROM products WHERE slug = $1 LIMIT 1`,
      [r.product_slug]
    );
    const productId = products[0]?.id || null;

    const result = await pool.query(
      `INSERT INTO reviews (
         product_id, product_slug, customer_email, customer_name,
         rating, title, content, status, verified_purchase,
         created_at, published_at
       )
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::int,
              $6::varchar, $7::text, $8::varchar, $9::boolean,
              $10::timestamp, $11::timestamp
       WHERE NOT EXISTS (
         SELECT 1 FROM reviews
         WHERE product_slug = $2::varchar
           AND customer_email = $3::varchar
           AND title IS NOT DISTINCT FROM $6::varchar
       )
       RETURNING id`,
      [
        productId,
        r.product_slug,
        r.customer_email.toLowerCase(),
        r.customer_name,
        r.rating,
        r.title,
        r.content,
        r.status,
        r.verified_purchase,
        r.created_at,
        r.published_at,
      ]
    );
    if (result.rows.length) inserted += 1;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reviews WHERE status = 'published'`
  );
  console.log(
    `Import OK — ${inserted} nouveau(x), ${rows[0].count} publié(s) au total.`
  );
  await pool.end();
}

importReviews().catch((err) => {
  console.error("Erreur import-reviews:", err);
  process.exit(1);
});
