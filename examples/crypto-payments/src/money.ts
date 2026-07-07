/**
 * Currency-aware conversion between integer minor units and the decimal
 * "major unit" strings that most provider APIs expect. Blindly dividing by 100
 * is wrong for zero-decimal fiat (JPY, KRW) and for crypto tickers with more
 * than two decimals, so the exponent is looked up per currency.
 */

/** ISO 4217 currencies with no minor unit. */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** Common crypto tickers and the decimal precision used for display/pricing. */
const CRYPTO_DECIMALS: Record<string, number> = {
  BTC: 8, BCH: 8, LTC: 8, DOGE: 8, ETH: 8, SOL: 9, USDC: 6, USDT: 6, DAI: 6,
};

/** Number of decimal places for a fiat or crypto currency (default 2). */
export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (c in CRYPTO_DECIMALS) return CRYPTO_DECIMALS[c]!;
  if (ZERO_DECIMAL.has(c)) return 0;
  return 2;
}

/**
 * Format an integer minor-unit amount as a fixed-precision decimal string,
 * using exact integer/string math (no floating point) so large crypto values
 * don't lose precision.
 */
export function minorToMajorString(amountMinor: number, currency: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new Error("amountMinor must be an integer number of minor units");
  }
  const exp = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const digits = Math.abs(amountMinor).toString();
  if (exp === 0) return `${sign}${digits}`;
  const padded = digits.padStart(exp + 1, "0");
  const whole = padded.slice(0, padded.length - exp);
  const frac = padded.slice(padded.length - exp);
  return `${sign}${whole}.${frac}`;
}
