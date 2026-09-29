import { dueDate, paymentSchedule, shanghaiDate } from './loan-schedule';

const terms = { principal: 120000, annualRate: 3.6, years: 1,
  startDate: '2024-01-31', repaymentDay: 31, repaymentMethod: 'equal_payment' };

describe('loan schedule', () => {
  it('uses next month, clamps month ends and preserves the original day afterwards', () => {
    expect(dueDate(terms, 1)).toBe('2024-02-29');
    expect(dueDate(terms, 2)).toBe('2024-03-31');
    expect(dueDate(terms, 12)).toBe('2025-01-31');
  });
  it('uses Shanghai calendar dates at UTC day boundaries', () => {
    expect(shanghaiDate(new Date('2026-09-27T16:00:00Z'))).toBe('2026-09-28');
  });
  it('calculates equal payment with a final rounding adjustment', () => {
    const values = paymentSchedule(terms).map(value => value.toNumber());
    expect(values).toHaveLength(12);
    expect(values.slice(0, 11)).toEqual(Array(11).fill(10196.07));
    expect(values[11]).toBeCloseTo(10196.07, 0);
  });
  it('reduces equal principal installments each month', () => {
    const values = paymentSchedule({ ...terms, repaymentMethod: 'equal_principal' });
    expect(values[0].toNumber()).toBe(10360);
    expect(values[1].toNumber()).toBe(10330);
    expect(values[11].toNumber()).toBe(10030);
  });
  it('handles zero interest and tiny loans without negative installments', () => {
    for (const repaymentMethod of ['equal_payment', 'equal_principal']) {
      const values = paymentSchedule({ ...terms, repaymentMethod, principal: 0.01, annualRate: 0, years: 50 });
      expect(values.every(value => value.gte(0))).toBe(true);
      expect(values.reduce((sum, value) => sum + value.toNumber(), 0)).toBe(0.01);
    }
  });
});
