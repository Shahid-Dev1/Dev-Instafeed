/** YYYY-MM-DD of an instant in an IANA timezone (store-local reporting day). */
export function localDate(at: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Decimal amount string → integer minor units using the currency's ISO exponent (INR 2, JPY 0, KWD 3). */
export function toMinor(amount: string | number | null | undefined, currency: string): bigint {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 0n;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* unknown currency code: assume 2 */
  }
  return BigInt(Math.round(n * 10 ** digits));
}
