import dotenv from "dotenv";

dotenv.config();

import pool from "../src/db/pool.js";
import {
  sendReferralInviteEmail,
  sendReferralRewardEmail,
} from "../src/lib/email.js";

const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const MARRAINE_EMAIL = TEST_EMAIL;
const MARRAINE_NAME = "Client Test";
const FILLEULE_EMAIL = `filleule+${TEST_EMAIL.split("@")[0]}@${TEST_EMAIL.split("@")[1] || "example.com"}`;
const FILLEULE_NAME = "Filleule Test";

function normalizeReferralBase(name) {
  return (
    name
      ?.split(" ")[0]
      ?.toLowerCase()
      ?.normalize("NFD")
      ?.replace(/[\u0300-\u036f]/g, "")
      ?.replace(/[^a-z0-9]/g, "") || "client"
  );
}

console.log("🧪 Test flux parrainage complet\n");

await pool.query(`UPDATE referral_config SET active = true WHERE id = 1`);
console.log("✅ 1. Programme parrainage activé");

const code = `${normalizeReferralBase(MARRAINE_NAME)}-TEST1`;
await pool.query(
  `
  INSERT INTO referrals (referrer_email, referrer_name, referral_code)
  VALUES ($1, $2, $3)
  ON CONFLICT (referral_code) DO UPDATE SET
    referrer_email = EXCLUDED.referrer_email,
    referrer_name = EXCLUDED.referrer_name
`,
  [MARRAINE_EMAIL, MARRAINE_NAME, code]
);
console.log(`✅ 2. Code parrainage créé : ${code}`);

await sendReferralInviteEmail({
  email: MARRAINE_EMAIL,
  customerName: MARRAINE_NAME,
  referralCode: code,
  referrerDiscountPercent: 10,
  refereeDiscountPercent: 10,
});
console.log(`✅ 3. Email invitation envoyé à ${MARRAINE_EMAIL}`);

await pool.query(
  `
  UPDATE referrals SET
    referee_email = $1,
    status = 'clicked'
  WHERE referral_code = $2
`,
  [FILLEULE_EMAIL, code]
);
console.log(`✅ 4. Clic simulé — ${FILLEULE_NAME} a cliqué sur le lien`);

await pool.query(
  `
  UPDATE referrals SET
    status = 'converted',
    referee_email = $1,
    converted_at = NOW()
  WHERE referral_code = $2
`,
  [FILLEULE_EMAIL, code]
);
console.log(`✅ 5. Commande simulée — ${FILLEULE_NAME} a commandé`);

const rewardCode = `MERCI-${code.toUpperCase().substring(0, 8)}`;
await pool.query(
  `
  INSERT INTO promo_codes (code, type, value, max_uses, active, internal_note)
  VALUES ($1, 'percent', 10, 1, true, 'Code parrainage test')
  ON CONFLICT (code) DO NOTHING
`,
  [rewardCode]
);
console.log(`✅ 6. Code récompense créé : ${rewardCode}`);

await sendReferralRewardEmail({
  email: MARRAINE_EMAIL,
  customerName: MARRAINE_NAME,
  referrerPromoCode: rewardCode,
  discountPercent: 10,
});
console.log(`✅ 7. Email récompense envoyé à ${MARRAINE_EMAIL}`);

const result = await pool.query(
  `
  SELECT referral_code, referrer_email, referee_email, status, converted_at
  FROM referrals WHERE referral_code = $1
`,
  [code]
);
console.log("\n📊 État final en base :");
console.log(result.rows[0]);

await pool.query(`DELETE FROM referrals WHERE referral_code = $1`, [code]);
await pool.query(`DELETE FROM promo_codes WHERE code = $1`, [rewardCode]);
console.log("\n🧹 Données de test nettoyées");

console.log("\n✅ Flux complet testé avec succès !");
console.log("📧 Vérifie la boîte email :");
console.log(`   - ${MARRAINE_EMAIL} → email invitation + email récompense`);

await pool.end();
