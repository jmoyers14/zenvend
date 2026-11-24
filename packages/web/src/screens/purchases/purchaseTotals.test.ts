import { describe, expect, test } from "bun:test";
import { isReceiptMismatch, linesTotalCentsFor } from "./purchaseTotals.ts";

const purchase = (lineCents: number[], receiptTotalCents: number | null = null) => ({
  lines: lineCents.map((totalCostCents) => ({ totalCostCents })),
  receiptTotalCents,
});

test("linesTotalCentsFor adds the lines", () => {
  expect(linesTotalCentsFor(purchase([1299, 501]))).toBe(1800);
});

describe("isReceiptMismatch", () => {
  test("is false with no receipt total", () => {
    expect(isReceiptMismatch(purchase([1800]))).toBe(false);
  });

  test("is false when the lines match the receipt", () => {
    expect(isReceiptMismatch(purchase([1299, 501], 1800))).toBe(false);
  });

  test("is true when they don't", () => {
    expect(isReceiptMismatch(purchase([1299], 1800))).toBe(true);
  });
});
