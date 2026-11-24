import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOptionStockDelta,
  assertItemsHaveStock,
  decrementItemsStock,
  findOptionIndex,
  optionLabel,
} from "./variantStock.js";

describe("variantStock helpers", () => {
  it("optionLabel size_color / custom / size", () => {
    assert.equal(
      optionLabel("size_color", { size: "M", color: "Rouge" }),
      "M / Rouge",
    );
    assert.equal(
      optionLabel("custom", { attribute: "Parfum", name: "Rose" }),
      "Parfum: Rose",
    );
    assert.equal(optionLabel("size", { name: "L" }), "L");
  });

  it("applyOptionStockDelta refuse un stock négatif", () => {
    const options = [{ name: "M", stock: 1 }];
    assert.throws(
      () => applyOptionStockDelta(options, "size", "M", -2),
      (err) => err.code === "OUT_OF_STOCK",
    );
  });
});

/** Mini faux client pg pour les 4 scénarios métier. */
function createFakeClient(seed) {
  const state = {
    products: structuredClone(seed.products),
    variants: structuredClone(seed.variants || {}),
    movements: [],
  };

  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("SELECT id, name, slug, stock, has_variants")) {
        const id = params[0];
        const p = state.products.find((x) => x.id === id);
        return { rows: p ? [p] : [] };
      }

      if (q.startsWith("SELECT type, options FROM product_variants")) {
        const id = params[0];
        const v = state.variants[id];
        return { rows: v ? [v] : [] };
      }

      if (q.startsWith("SELECT has_variants, variant_type FROM products")) {
        const id = params[0];
        const p = state.products.find((x) => x.id === id);
        return {
          rows: p
            ? [{ has_variants: p.has_variants, variant_type: p.variant_type }]
            : [],
        };
      }

      if (q.startsWith("UPDATE products SET stock = GREATEST")) {
        const [qty, id] = params;
        const p = state.products.find((x) => x.id === id);
        if (p) p.stock = Math.max(0, p.stock - qty);
        return { rows: [] };
      }

      if (q.startsWith("UPDATE product_variants SET options")) {
        const [json, id] = params;
        state.variants[id] = {
          ...state.variants[id],
          options: JSON.parse(json),
        };
        return { rows: [] };
      }

      if (q.startsWith("INSERT INTO stock_movements")) {
        state.movements.push({
          product_id: params[0],
          order_id: params[1],
          quantity_change: params[2],
          reason: "order",
          variant_label: params[3],
        });
        return { rows: [] };
      }

      throw new Error(`SQL non mocké: ${q}`);
    },
  };
}

describe("assert + decrement — 4 cas métier", () => {
  it("1. achat d'une variante : décrémente option + mouvement labellisé", async () => {
    const client = createFakeClient({
      products: [
        {
          id: "p1",
          name: "Robe",
          slug: "robe",
          stock: 10,
          has_variants: true,
          variant_type: "size",
        },
      ],
      variants: {
        p1: {
          type: "size",
          options: [
            { name: "S", stock: 2 },
            { name: "M", stock: 5 },
          ],
        },
      },
    });

    const items = [
      {
        product_id: "p1",
        name: "Robe",
        quantity: 2,
        variant: { type: "size", label: "M" },
      },
    ];

    await assertItemsHaveStock(client, items);
    await decrementItemsStock(client, "order-1", items);

    assert.equal(findOptionIndex(client.state.variants.p1.options, "size", "M"), 1);
    assert.equal(client.state.variants.p1.options[1].stock, 3);
    assert.equal(client.state.products[0].stock, 8);
    assert.equal(client.state.movements.length, 1);
    assert.equal(client.state.movements[0].variant_label, "M");
    assert.equal(client.state.movements[0].quantity_change, -2);
  });

  it("2. variante épuisée : refuse avec OUT_OF_STOCK", async () => {
    const client = createFakeClient({
      products: [
        {
          id: "p1",
          name: "Robe",
          slug: "robe",
          stock: 10,
          has_variants: true,
          variant_type: "size",
        },
      ],
      variants: {
        p1: { type: "size", options: [{ name: "M", stock: 0 }] },
      },
    });

    await assert.rejects(
      () =>
        assertItemsHaveStock(client, [
          {
            product_id: "p1",
            name: "Robe",
            quantity: 1,
            variant: { type: "size", label: "M" },
          },
        ]),
      (err) => err.code === "OUT_OF_STOCK",
    );
  });

  it("3. produit sans variante : comportement historique (stock produit)", async () => {
    const client = createFakeClient({
      products: [
        {
          id: "p2",
          name: "Huile",
          slug: "huile",
          stock: 4,
          has_variants: false,
          variant_type: "size",
        },
      ],
      variants: {},
    });

    const items = [{ product_id: "p2", name: "Huile", quantity: 1 }];
    await assertItemsHaveStock(client, items);
    await decrementItemsStock(client, "order-2", items);

    assert.equal(client.state.products[0].stock, 3);
    assert.equal(client.state.movements[0].variant_label, null);
    assert.equal(Object.keys(client.state.variants).length, 0);
  });

  it("4. paiement rejoué : second décrement refusé si on re-vérifie après le premier", async () => {
    const client = createFakeClient({
      products: [
        {
          id: "p1",
          name: "Robe",
          slug: "robe",
          stock: 10,
          has_variants: true,
          variant_type: "size",
        },
      ],
      variants: {
        p1: { type: "size", options: [{ name: "M", stock: 1 }] },
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

    await assertItemsHaveStock(client, items);
    await decrementItemsStock(client, "order-1", items);
    assert.equal(client.state.variants.p1.options[0].stock, 0);
    assert.equal(client.state.movements.length, 1);

    // Second passage (si fulfillment n'était pas idempotent) : stock à 0
    await assert.rejects(
      () => assertItemsHaveStock(client, items),
      (err) => err.code === "OUT_OF_STOCK",
    );
    assert.equal(client.state.movements.length, 1);
  });
});
