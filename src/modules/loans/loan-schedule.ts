import { Decimal } from '@prisma/client/runtime/client';

export interface LoanTerms {
  principal: Decimal | number;
  annualRate: Decimal | number;
  years: number;
  startDate: string;
  repaymentDay: number;
  repaymentMethod: string;
}

export function shanghaiDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function dueDate(loan: LoanTerms, installment: number): string {
  const [year, month] = loan.startDate.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + installment, 1));
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(loan.repaymentDay, days));
  return first.toISOString().slice(0, 10);
}

// Calculate the full schedule so skipped historical installments retain their original interest.
export function paymentSchedule(loan: LoanTerms): Decimal[] {
  const principal = new Decimal(loan.principal);
  const rate = new Decimal(loan.annualRate).div(1200);
  const count = loan.years * 12;
  const fixedPrincipal = principal.div(count).toDecimalPlaces(2);
  const growth = rate.add(1).pow(count);
  const fixedPayment = rate.isZero()
    ? fixedPrincipal
    : principal.mul(rate).mul(growth).div(growth.sub(1)).toDecimalPlaces(2);
  let remaining = principal;
  return Array.from({ length: count }, (_, index) => {
    const interest = remaining.mul(rate).toDecimalPlaces(2);
    const capital = index === count - 1
      ? remaining
      : Decimal.min(remaining, Decimal.max(0,
        loan.repaymentMethod === 'equal_principal' ? fixedPrincipal : fixedPayment.sub(interest)));
    remaining = remaining.sub(capital);
    return capital.add(interest);
  });
}
