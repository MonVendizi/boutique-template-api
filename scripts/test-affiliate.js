import dotenv from 'dotenv'
import pool from '../src/db/pool.js'

dotenv.config()

// Simule ce que le webhook fait après un paiement
const affiliateCode = 'fallet'
const totalCents = 1989
const orderId = '573c79c8-test-affiliation'

// 1. Vérifie que l'affilié existe
const affiliate = await pool.query(
  `SELECT * FROM affiliates WHERE code = $1 AND active = true`,
  [affiliateCode]
)

if (!affiliate.rows.length) {
  console.log('Affilié non trouvé')
  process.exit(1)
}

const aff = affiliate.rows[0]
const commission = Math.round(totalCents * aff.commission_percent / 100)

console.log(`Affilié trouvé: ${aff.name}`)
console.log(`Commission: ${commission} centimes (${aff.commission_percent}% de ${totalCents} centimes)`)
console.log(`OrderId (simulé): ${orderId}`)

// 2. Met à jour les stats de l'affilié
await pool.query(`
  UPDATE affiliates SET
    total_orders = total_orders + 1,
    total_revenue_cents = total_revenue_cents + $1,
    total_commission_cents = total_commission_cents + $2
  WHERE code = $3
`, [totalCents, commission, affiliateCode])

// 3. Vérifie le résultat
const result = await pool.query(
  `SELECT total_orders, total_revenue_cents, total_commission_cents FROM affiliates WHERE code = $1`,
  [affiliateCode]
)

console.log('Stats après test:', result.rows[0])
console.log('✅ Test affiliation OK')

await pool.end()
