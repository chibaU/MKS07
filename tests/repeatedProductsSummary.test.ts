import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRepeatedProductSummaries,
  normalizeProductName,
} from "../src/services/repeatedProductsSummary.ts";

test("normalizeProductName strips excess whitespace", () => {
  assert.equal(normalizeProductName("  طماطم   طازجة  "), "طماطم طازجة");
});

test("calculateRepeatedProductSummaries ignores non-repeated products", () => {
  const input = [
    { product: "طماطم", weight: "10.00", subtotal: "1.000,00" },
    { product: "بطاطا", weight: "20.00", subtotal: "2.000,00" },
  ];
  const result = calculateRepeatedProductSummaries(input);
  assert.equal(result.length, 0);
});

test("calculateRepeatedProductSummaries aggregates repeated products", () => {
  const input = [
    { product: "طماطم", weight: "10.00", subtotal: "1.000,00" },
    { product: "بطاطا", weight: "20.00", subtotal: "2.000,00" },
    { product: "طماطم", weight: "15.50", subtotal: "1.550,00" },
  ];
  const result = calculateRepeatedProductSummaries(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].product, "طماطم");
  assert.equal(result[0].totalWeight, "25.50");
  assert.equal(result[0].totalAmount, "2.550,00");
  assert.equal(result[0].breakEvenPrice, "100,00");
});
