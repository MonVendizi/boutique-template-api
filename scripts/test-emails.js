import "dotenv/config";
import {
  sendOrderConfirmationEmail,
  sendOrderPreparationEmail,
  sendOrderShippedEmail,
} from "../src/lib/email.js";

const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";

const testOrder = {
  email: TEST_EMAIL,
  orderId: "TEST-001",
  customerName: "Client Test",
  items: [
    { name: "Produit Exemple A", qty: 1, price: 19.9 },
    { name: "Produit Exemple B", qty: 1, price: 29.9 },
  ],
  total: 49.8,
};

console.log(`Envoi des emails de test pour ${BRAND_NAME} → ${TEST_EMAIL}`);

console.log("Envoi email 1 - Confirmation...");
await sendOrderConfirmationEmail({
  email: testOrder.email,
  orderId: testOrder.orderId,
  customerName: testOrder.customerName,
  items: testOrder.items.map((i) => ({
    name: i.name,
    quantity: i.qty,
    price: i.price,
  })),
  total: Math.round(testOrder.total * 100),
  currency: "eur",
});

console.log("Envoi email 2 - Préparation...");
await sendOrderPreparationEmail({
  email: testOrder.email,
  orderId: testOrder.orderId,
  customerName: testOrder.customerName,
});

console.log("Envoi email 3 - Expédition...");
await sendOrderShippedEmail({
  email: testOrder.email,
  orderId: testOrder.orderId,
  customerName: testOrder.customerName,
  trackingNumber: "6V12345678901",
  carrier: "Colissimo",
});

console.log("✅ 3 emails envoyés");
