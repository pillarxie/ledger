import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { SubscriptionsService } from './subscriptions.service';

const base = { id: 'sub-1', userId: 'user-1', accountId: 'account-1', name: '会员',
  cycle: 'monthly', amount: new Decimal('19.90'), firstChargeDate: '2026-01-20',
  status: 'active', stoppedAt: null as Date | null, lastChargeDate: null as string | null,
  processedInstallments: 0 };
const createDto = { name: '会员', accountId: 'account-1', cycle: 'monthly' as const,
  amount: 19.9, firstChargeDate: '2026-01-20' };

function mockDb(overrides: Partial<typeof base> = {}) {
  let row = { ...base, ...overrides };
  const db: any = {
    subscription: {
      findUnique: jest.fn(async () => ({ ...row })),
      findFirst: jest.fn(async ({ where }) => where.userId === row.userId ? { ...row } : null),
      findMany: jest.fn(async () => [{ ...row }]),
      create: jest.fn(async ({ data }) => (row = { ...row, ...data })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value)) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      }),
    },
    account: { findFirst: jest.fn(async () => ({ id: 'account-1' })), update: jest.fn() },
    category: { upsert: jest.fn() },
    transaction: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const before = { ...row };
      try { return await fn(db); }
      catch (error) { row = before; throw error; }
    }),
  };
  return db;
}

describe('SubscriptionsService', () => {
  afterEach(() => jest.useRealTimers());
  function setup(overrides: Partial<typeof base> = {}) {
    const db = mockDb(overrides);
    return { db, service: new SubscriptionsService(db) };
  }

  it('records every missed installment once with its original date and amount', async () => {
    const { db, service } = setup();
    await service.processSubscription('sub-1', '2026-03-20');
    await service.processSubscription('sub-1', '2026-03-20');
    expect(db.transaction.create).toHaveBeenCalledTimes(3);
    expect(db.transaction.create.mock.calls[1][0].data).toMatchObject({
      subscriptionId: 'sub-1', subscriptionInstallment: 2, accountId: 'account-1',
      note: '自动续费-会员',
      type: 'expense', amount: new Decimal('19.90'), date: new Date('2026-02-20T00:00:00Z'),
    });
    expect(db.account.update).toHaveBeenCalledTimes(3);
    expect(db.account.update.mock.calls[0][0].data.balance.decrement.toNumber()).toBe(19.9);
  });
  it('allows only one concurrent claim', async () => {
    const { db, service } = setup();
    await Promise.all([service.processSubscription('sub-1', '2026-01-20'), service.processSubscription('sub-1', '2026-01-20')]);
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });
  it('rolls back the claim on failure and retries the same installment', async () => {
    const { db, service } = setup();
    db.transaction.create.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(service.processSubscription('sub-1', '2026-01-20')).rejects.toThrow('temporary failure');
    await service.processSubscription('sub-1', '2026-01-20');
    expect(db.transaction.create.mock.calls.map((call: any) => call[0].data.subscriptionInstallment)).toEqual([1, 1]);
    expect(db.account.update).toHaveBeenCalledTimes(1);
  });
  it('keeps a monthly charge later this month but excludes the following month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T04:00:00Z'));
    const { db, service } = setup();
    const stopped = await service.stop('user-1', 'sub-1');
    expect(stopped).toMatchObject({ status: 'stopped', nextChargeDate: '2026-01-20', lastChargeDate: '2026-01-20' });
    await service.processSubscription('sub-1', '2026-03-20');
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
    expect((await service.list('user-1'))[0].nextChargeDate).toBeNull();
  });
  it('does not charge the next quarter when stopped after the current quarter charge', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-05T04:00:00Z'));
    const { db, service } = setup({ cycle: 'quarterly', processedInstallments: 1 });
    expect((await service.stop('user-1', 'sub-1')).lastChargeDate).toBe('2026-01-20');
    await service.processSubscription('sub-1', '2026-04-20');
    expect(db.transaction.create).not.toHaveBeenCalled();
  });
  it('retains the first charge even when stopped before the first charge month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-12-05T04:00:00Z'));
    const { db, service } = setup({ cycle: 'yearly' });
    expect((await service.stop('user-1', 'sub-1')).nextChargeDate).toBe('2026-01-20');
    await service.processSubscription('sub-1', '2028-01-20');
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });
  it('repeated stops never extend the final allowed period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T04:00:00Z'));
    const { service } = setup();
    const original = await service.stop('user-1', 'sub-1');
    jest.setSystemTime(new Date('2026-03-05T04:00:00Z'));
    const repeated = await service.stop('user-1', 'sub-1');
    expect(repeated.lastChargeDate).toBe(original.lastChargeDate);
    expect(repeated.stoppedAt).toEqual(original.stoppedAt);
  });
  it('retries a stale processing claim when stopping changed its state', async () => {
    const { db, service } = setup();
    db.subscription.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.processSubscription('sub-1', '2026-01-20');
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sub-1', status: 'active', lastChargeDate: null, processedInstallments: 0 },
    }));
  });
  it('skips charges before creation but records one due today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-20T04:00:00Z'));
    const { db, service } = setup();
    await service.create('user-1', createDto);
    expect(db.subscription.create.mock.calls[0][0].data.processedInstallments).toBe(2);
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
    expect(db.transaction.create.mock.calls[0][0].data.subscriptionInstallment).toBe(3);
  });
  it('skips a historical current-period charge and waits for the next one', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-21T04:00:00Z'));
    const { db, service } = setup();
    expect((await service.create('user-1', createDto)).nextChargeDate).toBe('2026-04-20');
    expect(db.transaction.create).not.toHaveBeenCalled();
  });
  it('rejects invalid dates and inaccessible accounts', async () => {
    const { db, service } = setup();
    await expect(service.create('user-1', { ...createDto, firstChargeDate: '2026-02-30' })).rejects.toThrow(BadRequestException);
    db.account.findFirst.mockResolvedValue(null);
    await expect(service.create('user-1', createDto)).rejects.toThrow(NotFoundException);
    expect(db.subscription.create).not.toHaveBeenCalled();
  });
  it('rejects stopping another user subscription', async () => {
    const { db, service } = setup();
    await expect(service.stop('other', 'sub-1')).rejects.toThrow(NotFoundException);
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });
  it('keeps saved subscriptions accessible while processing temporarily fails', async () => {
    const { service } = setup();
    jest.spyOn(service, 'processSubscription').mockRejectedValue(new Error('unavailable'));
    expect((await service.create('user-1', createDto)).id).toBe('sub-1');
    expect(await service.list('user-1')).toHaveLength(1);
  });
  it('restores the dedicated category to personal expense scope before recording', async () => {
    const { db, service } = setup();
    await service.processSubscription('sub-1', '2026-01-20');
    expect(db.category.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { type: 'expense', familyId: null, isFamilyShared: false },
      create: expect.objectContaining({ name: '自动续费', userId: 'user-1' }),
    }));
  });
});
