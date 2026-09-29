import { chargeDate, currentInstallment, shanghaiDate } from './subscription-schedule';

describe('subscription schedule', () => {
  it('keeps the original monthly day after short months', () => {
    const terms = { cycle: 'monthly', firstChargeDate: '2028-01-31' };
    expect([1, 2, 3].map(index => chargeDate(terms, index)))
      .toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });
  it('supports quarterly and yearly calendar increments', () => {
    expect(chargeDate({ cycle: 'quarterly', firstChargeDate: '2026-11-30' }, 2)).toBe('2027-02-28');
    const yearly = { cycle: 'yearly', firstChargeDate: '2028-02-29' };
    expect(chargeDate(yearly, 2)).toBe('2029-02-28');
    expect(chargeDate(yearly, 5)).toBe('2032-02-29');
  });
  it('anchors stop periods to the first charge month, not the charge day', () => {
    const terms = { cycle: 'quarterly', firstChargeDate: '2026-01-20' };
    expect(currentInstallment(terms, '2025-12-01')).toBe(1);
    expect(currentInstallment(terms, '2026-01-05')).toBe(1);
    expect(currentInstallment(terms, '2026-02-05')).toBe(1);
    expect(currentInstallment(terms, '2026-04-05')).toBe(2);
    expect(currentInstallment({ ...terms, cycle: 'yearly' }, '2027-01-05')).toBe(2);
  });
  it('changes the date at Shanghai midnight', () => {
    expect(shanghaiDate(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09-30');
    expect(shanghaiDate(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01');
  });
});
