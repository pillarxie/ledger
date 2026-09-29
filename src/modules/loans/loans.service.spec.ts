import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { LoansService } from './loans.service';

const baseLoan = { id: 'loan-1', userId: 'user-1', accountId: 'account-1', name: '房贷',
  principal: new Decimal(12000), annualRate: new Decimal(0), years: 1,
  startDate: '2026-01-01', repaymentDay: 31, repaymentMethod: 'equal_payment',
  status: 'active', processedInstallments: 0 };

function mockDb() {
  let loan = { ...baseLoan };
  const db: any = {
    loan: {
      findUnique: jest.fn(async () => ({ ...loan })),
      findFirst: jest.fn(async ({ where }) => where.userId === loan.userId ? { ...loan } : null),
      findMany: jest.fn(async () => [{ ...loan }]),
      create: jest.fn(async ({ data }) => (loan = { ...loan, ...data })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.status !== loan.status ||
            (where.processedInstallments !== undefined && where.processedInstallments !== loan.processedInstallments)) return { count: 0 };
        loan = { ...loan, ...data };
        return { count: 1 };
      }),
    },
    account: { findFirst: jest.fn(async () => ({ id: 'account-1' })), update: jest.fn() },
    category: { upsert: jest.fn() },
    transaction: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(db)),
  };
  return db;
}

describe('LoansService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: LoansService;
  beforeEach(() => { db = mockDb(); service = new LoansService(db); });

  it('records due installments once with the correct account and dates', async () => {
    await service.processLoan('loan-1', '2026-03-31');
    await service.processLoan('loan-1', '2026-03-31');
    expect(db.transaction.create).toHaveBeenCalledTimes(2);
    expect(db.transaction.create.mock.calls[0][0].data).toMatchObject({
      accountId: 'account-1', loanId: 'loan-1', loanInstallment: 1, type: 'expense',
      date: new Date('2026-02-28T00:00:00.000Z'),
    });
    expect(db.account.update).toHaveBeenCalledTimes(2);
    expect(db.account.update.mock.calls[0][0].data.balance.decrement.toNumber()).toBe(1000);
  });
  it('allows only one concurrent processor to claim an installment', async () => {
    await Promise.all([service.processLoan('loan-1', '2026-02-28'), service.processLoan('loan-1', '2026-02-28')]);
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });
  it('stops future processing and preserves generated records', async () => {
    await service.processLoan('loan-1', '2026-02-28');
    expect((await service.stop('user-1', 'loan-1')).status).toBe('stopped');
    await service.processLoan('loan-1', '2026-03-31');
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });
  it('rejects stopping a loan belonging to another user', async () => {
    await expect(service.stop('other-user', 'loan-1')).rejects.toThrow(NotFoundException);
    expect(db.loan.updateMany).not.toHaveBeenCalled();
  });
  it('skips historical installments but includes repayments due on creation day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-31T04:00:00Z'));
    try {
      await service.create('user-1', { ...baseLoan, principal: 12000, annualRate: 0, repaymentMethod: 'equal_payment' });
      expect(db.loan.create.mock.calls[0][0].data.processedInstallments).toBe(1);
      expect(db.transaction.create).toHaveBeenCalledTimes(1);
      expect(db.transaction.create.mock.calls[0][0].data.loanInstallment).toBe(2);
    } finally { jest.useRealTimers(); }
  });
  it('returns a saved loan when immediate processing fails', async () => {
    jest.spyOn(service, 'processLoan').mockRejectedValue(new Error('temporary database failure'));
    const loan = await service.create('user-1', { ...baseLoan, principal: 12000, annualRate: 0, repaymentMethod: 'equal_payment' });
    expect(loan.id).toBe('loan-1');
    expect(db.loan.create).toHaveBeenCalledTimes(1);
  });
  it('keeps the list available when processing fails so users can stop loans', async () => {
    jest.spyOn(service, 'processLoan').mockRejectedValue(new Error('temporary database failure'));
    const loans = await service.list('user-1');
    expect(loans).toHaveLength(1);
    expect(loans[0].id).toBe('loan-1');
  });
  it('repairs the dedicated category scope and type before posting', async () => {
    await service.processLoan('loan-1', '2026-02-28');
    expect(db.category.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { type: 'expense', familyId: null, isFamilyShared: false },
    }));
  });
  it('completes the final installment and never generates beyond the term', async () => {
    await service.processLoan('loan-1', '2030-01-01');
    const rows = await service.list('user-1');
    expect(db.transaction.create).toHaveBeenCalledTimes(12);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].nextPayment).toBeNull();
  });
});
