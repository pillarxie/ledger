import { Test, TestingModule } from '@nestjs/testing';
import { SyncService } from './sync.service';
import { PrismaService } from '../../prisma/prisma.service';

const LAST_SYNC = '2025-01-10T00:00:00.000Z';
const LAST_SYNC_DATE = new Date(LAST_SYNC);

function buildPrismaMock() {
  const prisma: any = {
    getUserFamilyIds: jest.fn().mockResolvedValue(['f-1']),
    familyMember: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'c-1', type: 'expense' }),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    account: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'a-1' }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    budget: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
    syncLog: {
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  return prisma;
}

describe('SyncService', () => {
  let service: SyncService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SyncService);
  });

  /* ========================== getConflicts ========================== */

  describe('getConflicts', () => {
    const userId = 'u-1';
    const dto = {
      deviceId: 'dev-1',
      lastSyncAt: LAST_SYNC,
      transactions: [
        // 客户端在同步后又修改过
        { id: 't-1', updatedAt: '2025-01-12T00:00:00.000Z' },
      ],
      categories: [],
      accounts: [],
      budgets: [],
    };

    it('客户端和服务端都修改过 → 返回冲突及服务端版本', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 't-1',
          amount: 123.45,
          updatedAt: new Date('2025-01-13T00:00:00.000Z'),
        },
      ]);

      const result = await service.getConflicts(userId, dto);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['t-1'] },
          OR: [
            { userId },
            { familyId: { in: ['f-1'] }, isFamilyShared: true },
          ],
        },
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toEqual({
        id: 't-1',
        client: { updatedAt: '2025-01-12T00:00:00.000Z', deleted: false },
        server: {
          id: 't-1',
          amount: 123.45,
          updatedAt: new Date('2025-01-13T00:00:00.000Z'),
        },
      });
      expect(result.categories).toEqual([]);
    });

    it('仅客户端修改（服务端未变）→ 不冲突', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 't-1',
          updatedAt: new Date('2025-01-05T00:00:00.000Z'), // 早于 lastSyncAt
        },
      ]);

      const result = await service.getConflicts(userId, dto);

      expect(result.transactions).toEqual([]);
    });

    it('仅服务端修改（客户端版本早于 lastSyncAt）→ 不冲突', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 't-1',
          updatedAt: new Date('2025-01-13T00:00:00.000Z'),
        },
      ]);

      const result = await service.getConflicts(userId, {
        ...dto,
        transactions: [
          { id: 't-1', updatedAt: '2025-01-02T00:00:00.000Z' },
        ],
      });

      expect(result.transactions).toEqual([]);
    });

    it('服务端记录不存在（可能被删除）→ 不冲突', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getConflicts(userId, dto);

      expect(result.transactions).toEqual([]);
    });

    it('未传实体列表时不查库', async () => {
      const result = await service.getConflicts(userId, {
        deviceId: 'dev-1',
        lastSyncAt: LAST_SYNC,
      });

      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      expect(result.transactions).toEqual([]);
    });

    it('服务端更新时间早于 lastSyncAt 但客户端也修改 → 边界：不算冲突', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 't-1',
          updatedAt: LAST_SYNC_DATE, // 等于 lastSyncAt，不算服务端修改
        },
      ]);

      const result = await service.getConflicts(userId, dto);

      expect(result.transactions).toEqual([]);
    });
  });

  /* ======================== resolveConflicts ======================== */

  describe('resolveConflicts', () => {
    const userId = 'u-1';

    it('useServer=false：用客户端数据 upsert', async () => {
      prisma.transaction.upsert.mockResolvedValue({ id: 't-1' });
      prisma.category.upsert.mockResolvedValue({ id: 'c-1' });

      const result = await service.resolveConflicts(userId, {
        transactions: [
          {
            id: 't-1',
            useServer: false,
            data: {
              id: 't-1',
              type: 'expense',
              amount: 10,
              categoryId: 'c-1',
              accountId: 'a-1',
              date: '2025-01-15T00:00:00.000Z',
            },
          },
        ],
        categories: [
          {
            id: 'c-1',
            useServer: false,
            data: {
              id: 'c-1',
              name: '餐饮',
              type: 'expense',
              icon: 'food',
              color: '#FF5722',
            },
          },
        ],
      });

      expect(prisma.transaction.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.category.upsert).toHaveBeenCalledTimes(1);
      expect(result.transactions).toEqual({ success: 1, failed: 0 });
      expect(result.categories).toEqual({ success: 1, failed: 0 });
    });

    it('useServer=true：保留服务器版本，不写库', async () => {
      const result = await service.resolveConflicts(userId, {
        transactions: [{ id: 't-1', useServer: true }],
      });

      expect(prisma.transaction.upsert).not.toHaveBeenCalled();
      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(result.transactions).toEqual({ success: 1, failed: 0 });
    });

    it('deleted=true：对账单执行软删除', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: 't-1', userId, amount: 10, type: 'expense', accountId: 'a-1', deletedAt: null });
      prisma.transaction.update.mockResolvedValue({ id: 't-1' });

      const result = await service.resolveConflicts(userId, {
        transactions: [{ id: 't-1', useServer: false, deleted: true }],
      });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.transactions).toEqual({ success: 1, failed: 0 });
    });

    it('useServer=false 且缺少 data → 计入失败', async () => {
      const result = await service.resolveConflicts(userId, {
        transactions: [{ id: 't-1', useServer: false }],
      });

      expect(result.transactions).toEqual({ success: 0, failed: 1 });
    });

    it('upsert 抛错 → 计入失败，不影响其他条目', async () => {
      prisma.transaction.upsert
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce({ id: 't-2' });

      const result = await service.resolveConflicts(userId, {
        transactions: [
          {
            id: 't-1',
            useServer: false,
            data: {
              id: 't-1',
              type: 'expense',
              amount: 1,
              categoryId: 'c-1',
              accountId: 'a-1',
              date: '2025-01-15T00:00:00.000Z',
            },
          },
          {
            id: 't-2',
            useServer: false,
            data: {
              id: 't-2',
              type: 'expense',
              amount: 2,
              categoryId: 'c-1',
              accountId: 'a-1',
              date: '2025-01-15T00:00:00.000Z',
            },
          },
        ],
      });

      expect(prisma.transaction.upsert).toHaveBeenCalledTimes(2);
      expect(result.transactions).toEqual({ success: 1, failed: 1 });
    });

    it('更新他人的记录 → 计入失败（越权保护）', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: 't-1',
        userId: 'other-user',
      });

      const result = await service.resolveConflicts(userId, {
        transactions: [
          {
            id: 't-1',
            useServer: false,
            data: {
              id: 't-1',
              type: 'expense',
              amount: 1,
              categoryId: 'c-1',
              accountId: 'a-1',
              date: '2025-01-15T00:00:00.000Z',
            },
          },
        ],
      });

      expect(prisma.transaction.upsert).not.toHaveBeenCalled();
      expect(result.transactions).toEqual({ success: 0, failed: 1 });
    });
  });

  /* ============================= push ============================= */

  describe('push', () => {
    const userId = 'u-1';
    const baseDto = {
      deviceId: 'dev-1',
      transactions: [
        {
          id: 't-1',
          type: 'expense',
          amount: 10,
          categoryId: 'c-1',
          accountId: 'a-1',
          date: '2025-01-15T00:00:00.000Z',
        },
      ],
    };

    it('推送本人新账单成功', async () => {
      prisma.transaction.upsert.mockResolvedValue({ id: 't-1' });

      const result = await service.push(userId, baseDto);

      expect(prisma.transaction.upsert).toHaveBeenCalledTimes(1);
      expect(result.transactions.success).toBe(1);
      expect(result.transactions.failed).toBe(0);
    });

    it('推送带 familyId 的账单但非成员 → 计入失败', async () => {
      prisma.familyMember.findFirst.mockResolvedValue(null);

      const result = await service.push(userId, {
        ...baseDto,
        transactions: [{ ...baseDto.transactions[0], familyId: 'f-99' }],
      });

      expect(prisma.transaction.upsert).not.toHaveBeenCalled();
      expect(result.transactions.success).toBe(0);
      expect(result.transactions.failed).toBe(1);
      expect(result.transactions.errors[0]).toContain('不是该家庭成员');
    });

    it('引用不存在的分类 → 计入失败', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      const result = await service.push(userId, baseDto);

      expect(prisma.transaction.upsert).not.toHaveBeenCalled();
      expect(result.transactions.failed).toBe(1);
      expect(result.transactions.errors[0]).toContain('分类不存在');
    });
  });
  describe('余额及备份回归', () => {
    const record = { id: 't-1', type: 'expense', amount: 10, categoryId: 'c-1', accountId: 'a-1', date: '2026-09-01T00:00:00Z' };

    it('不能通过删除冲突方案删除其他用户账单', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ ...record, userId: 'other' });
      const result = await service.resolveConflicts('u-1', {
        transactions: [{ id: 't-1', useServer: false, deleted: true }],
      });
      expect(result.transactions.failed).toBe(1);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('删除账单退回支出，再次删除不重复退回', async () => {
      const existing = { ...record, userId: 'u-1', deletedAt: null as Date | null };
      prisma.transaction.findUnique.mockImplementation(async () => existing);
      prisma.transaction.update.mockImplementation(async ({ data }: any) => Object.assign(existing, data));
      const dto = { transactions: [{ id: 't-1', useServer: false, deleted: true }] };
      await service.resolveConflicts('u-1', dto);
      await service.resolveConflicts('u-1', dto);
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
      expect(prisma.account.update.mock.calls[0][0].data.balance.increment.toNumber()).toBe(10);
    });

    it('重复推送同一个账单只影响一次余额', async () => {
      let existing: any = null;
      let balance = 100;
      prisma.transaction.findUnique.mockImplementation(async () => existing);
      prisma.transaction.upsert.mockImplementation(async ({ create, update }: any) => {
        existing = existing ? { ...existing, ...update } : { ...create, deletedAt: null };
        return existing;
      });
      prisma.account.update.mockImplementation(async ({ data }: any) => {
        balance += data.balance.increment.toNumber();
      });
      const dto = { deviceId: 'dev', transactions: [record] };
      await service.push('u-1', dto);
      await service.push('u-1', dto);
      expect(balance).toBe(90);
      await service.push('u-1', { ...dto, transactions: [{ ...record, amount: 25 }] });
      expect(balance).toBe(75);
    });

    it('新账号数据恢复保留快照余额，再恢复不会重复入账', async () => {
      let existing: any = null;
      let account: any = null;
      let balance = 0;
      prisma.transaction.findUnique.mockImplementation(async () => existing);
      prisma.transaction.upsert.mockImplementation(async ({ create }: any) => { existing = create; return existing; });
      prisma.account.findUnique.mockImplementation(async () => account);
      prisma.account.create.mockImplementation(async ({ data }: any) => { account = data; balance = data.balance.toNumber(); return account; });
      prisma.account.update.mockImplementation(async ({ data }: any) => { balance += data.balance.increment.toNumber(); });
      const dto = {
        deviceId: 'dev', ownerId: 'u-1', transactions: [record],
        accounts: [{ id: 'a-1', name: 'Cash', type: 'cash', balance: 90, icon: 'cash', color: '#000000' }],
      };
      const first = await service.restore('u-1', dto);
      expect(first.accounts.success).toBe(1);
      expect(first.transactions.success).toBe(1);
      expect(balance).toBe(90);
      const second = await service.restore('u-1', dto);
      expect(second.accounts.skipped).toBe(1);
      expect(second.transactions.skipped).toBe(1);
      expect(balance).toBe(90);
    });

    it('拒绝其他账号的备份且不写任何数据', async () => {
      await expect(service.restore('u-1', { ownerId: 'u-2', deviceId: 'dev' })).rejects.toThrow('只能恢复当前账号');
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('新建分类和账户在推送账单之前完成', async () => {
      const order: string[] = [];
      prisma.category.upsert.mockImplementation(async () => { order.push('category'); return {}; });
      prisma.account.upsert.mockImplementation(async () => { order.push('account'); return {}; });
      prisma.transaction.upsert.mockImplementation(async () => { order.push('transaction'); return {}; });
      await service.push('u-1', {
        deviceId: 'dev', transactions: [record],
        categories: [{ id: 'c-1', name: 'Food', type: 'expense', icon: 'food', color: '#000000' }],
        accounts: [{ id: 'a-1', name: 'Cash', type: 'cash', balance: 0, icon: 'cash', color: '#000000' }],
      });
      expect(order).toEqual(['category', 'account', 'transaction']);
    });
  });

});
