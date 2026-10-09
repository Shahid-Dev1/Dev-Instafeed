import { describe, expect, it } from 'vitest';
import { formatMoney, formatPct } from '../components/analytics/format';

describe('analytics formatting', () => {
  it('formats minor units by currency exponent', () => {
    expect(formatMoney(129700, 'INR')).toMatch(/1,297(\.00)?/);
    expect(formatMoney(1500, 'JPY')).toMatch(/1,500/);
    expect(formatMoney(12345, 'KWD')).toMatch(/12\.345/);
    expect(formatPct(0.1234)).toBe('12.3%');
  });
});
