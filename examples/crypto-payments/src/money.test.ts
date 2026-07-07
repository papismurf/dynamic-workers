import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyExponent, minorToMajorString } from "./money.js";

test("currencyExponent knows fiat, zero-decimal, and crypto precisions", () => {
  assert.equal(currencyExponent("USD"), 2);
  assert.equal(currencyExponent("eur"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KRW"), 0);
  assert.equal(currencyExponent("BTC"), 8);
  assert.equal(currencyExponent("USDC"), 6);
});

test("minorToMajorString converts without floating-point error", () => {
  assert.equal(minorToMajorString(2500, "USD"), "25.00");
  assert.equal(minorToMajorString(1, "USD"), "0.01");
  assert.equal(minorToMajorString(2500, "JPY"), "2500"); // no decimals
  assert.equal(minorToMajorString(12345678, "BTC"), "0.12345678");
  assert.equal(minorToMajorString(1000000, "USDC"), "1.000000");
  assert.equal(minorToMajorString(-500, "USD"), "-5.00");
});

test("minorToMajorString rejects non-integer minor units", () => {
  assert.throws(() => minorToMajorString(1.5, "USD"), /integer/);
});
