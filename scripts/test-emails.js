import "dotenv/config";
import {
  sendOrderConfirmationEmail,
  sendOrderPreparationEmail,
  sendOrderShippedEmail,
} from "../src/lib/email.js";

const testOrder = {
  email: "sebastien.fallet@outlook.com",
  orderId: "TEST-001",
  customerName: "Sébastien",
  items: [
    { name: "Beurre de Karité Brut", qty: 1, price: 14.99 },
    { name: "Tina Thé Minceur", qty: 1, price: 39.99 },
  ],
  total: 54.98,
};

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
