export interface SubscriptionTerms {
  cycle: string;
  firstChargeDate: string;
}

export function shanghaiDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function monthsPerCycle(cycle: string): number {
  return cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1;
}

/** Periods start in the first charge's calendar month, even before its charge day. */
export function currentInstallment(terms: SubscriptionTerms, today: string): number {
  const [year, month] = terms.firstChargeDate.split('-').map(Number);
  const [nowYear, nowMonth] = today.split('-').map(Number);
  return Math.max(0, Math.floor(((nowYear - year) * 12 + nowMonth - month) /
    monthsPerCycle(terms.cycle))) + 1;
}

export function chargeDate(terms: SubscriptionTerms, installment: number): string {
  const [year, month, day] = terms.firstChargeDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + (installment - 1) * monthsPerCycle(terms.cycle), 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
