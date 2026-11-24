import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertItemsHaveStock,
  decrementItemsStock,
} from "../lib/variantStock.js";
import { shouldSkipStockBecauseOrderExists } from "../lib/orderStockFulfillment.js";

function createFakeClient(seed) {
  const state = {
    products: structuredClone(seed.products),
    variants: structuredClone(seed.variants || {}),
    movements: [],
    orders: structuredClone(seed.orders || []),
  };

  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("SELECT id, name, slug, stock, has_variants")) {
        const p = state.products.find((x) => x.id === params[0]);
        return { rows: p ? [p] : [] };
      }
      if (q.startsWith("SELECT type, options FROM product_variants")) {
        const v = state.variants[params[0]];
        return { rows: v ? [v] : [] };
      }
      if (q.startsWith("SELECT has_variants, variant_type FROM products")) {
        const p = state.products.find((x) => x.id === params[0]);
        return {
          rows: p
            ? [{ has_variants: p.has_variants, variant_type: p.variant_type }]
            : [],
        };
      }
      if (q.startsWith("UPDATE products SET stock = GREATEST")) {
        const p = state.products.find((x) => x.id === params[1]);
        if (p) p.stock = Math.max(0, p.stock - params[0]);
        return { rows: [] };
      }
      if (q.startsWith("UPDATE product_variants SET options")) {
        state.variants[params[1]] = {
          ...state.variants[params[1]],
          options: JSON.parse(params[0]),
        };
        return { rows: [] };
      }
      if (q.startsWith("INSERT INTO stock_movements")) {
        state.movements.push({
          product_id: params[0],
          order_id: params[1],
          quantity_change: params[2],
          variant_label: params[3],
        });
        return { rows: [] };
      }
      throw new Error(`SQL non mocké: ${q}`);
    },
  };
}

/**
 * Miroir du flux fulfillOrderRecord (stock uniquement) :
 * 1) si commande déjà connue → skip
 * 2) sinon assert + decrement
 */
async function fulfillStockOnce(client, existingRows, orderId, items) {
  if (shouldSkipStockBecauseOrderExists(existingRows)) {
    return { skipped: true, orderId: existingRows[0].id };
  }
  await assertItemsHaveStock(client, items);
  await decrementItemsStock(client, orderId, items);
  return { skipped: false, orderId };
}

describe("webhook stock — idempotence paiement rejoué", () => {
  it("ne décrémente pas deux fois si la commande existe déjà (replay Stripe)", async () => {
    const client = createFakeClient({
      products: [
        {
          id: "p1",
          name: "Robe",
          slug: "robe",
          stock: 5,
          has_variants: true,
          variant_type: "size",
        },
      ],
      variants: {
        p1: { type: "size", options: [{ name: "M", stock: 2 }] },
      },
    });

    const items = [
      {
        product_id: "p1",
        name: "Robe",
        quantity: 1,
        variant: { type: "size", label: "M" },
      },
    ];

    const first = await fulfillStockOnce(client, [], "order-new", items);
    assert.equal(first.skipped, false);
    assert.equal(client.state.variants.p1.options[0].stock, 1);
    assert.equal(client.state.movements.length, 1);

    const second = await fulfillStockOnce(
      client,
      [{ id: "order-new" }],
      "order-new",
      items,
    );
    assert.equal(second.skipped, true);
    assert.equal(client.state.variants.p1.options[0].stock, 1);
    assert.equal(client.state.movements.length, 1);
  });
});
