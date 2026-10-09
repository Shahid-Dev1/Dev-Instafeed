/** Minor units → localized currency string, using the currency's ISO exponent. */
export function formatMoney(minor: number, currency: string | null): string {
  if (!currency) return (minor / 100).toFixed(2);
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  return fmt.format(minor / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 2));
}
export const formatInt = (n: number) => new Intl.NumberFormat().format(n);
export const formatPct = (r: number) => `${(r * 100).toFixed(1)}%`;
