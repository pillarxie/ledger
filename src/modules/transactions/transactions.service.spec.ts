import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';

function buildPrismaMock() {
  const prisma: any = {
    getUserFamilyIds: jest.fn().mockResolvedValue([]),
    familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
    account: {
      findFirst: jest.fn().mockResolvedValue({ id: 'a-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c-1', type: 'expense' }),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    // 交互式事务：直接以同一 mock 作为 tx 执行回调
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return Promise.all(arg);
    }),
  };
  return prisma;
}

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TransactionsService);
  });

  describe('create', () => {
    const dto = {
      type: TransactionType.expense,
      amount: 100.5,
      categoryId: 'c-1',
      accountId: 'a-1',
      date: '2025-01-15T10:00:00Z',
    };

    it('支出账单：创建记录并原子扣减账户余额', async () => {
      prisma.transaction.create.mockResolvedValue({ id: 't-1' });

      await service.create('u-1', dto);

      expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: { balance: { increment: new Decimal('-100.50') } },
      });
    });

    it('收入账单：原子增加账户余额', async () => {
      prisma.transaction.create.mockResolvedValue({ id: 't-1' });
      prisma.category.findFirst.mockResolvedValue({
        id: 'c-1',
        type: 'income',
      });

      await service.create('u-1', { ...dto, type: TransactionType.income });

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: { balance: { increment: new Decimal('100.50') } },
      });
    });

    it('isFamilyShared 但未指定家庭 → 400', async () => {
      await expect(
        service.create('u-1', { ...dto, isFamilyShared: true }),
      ).rejects.toThrow('家庭共享账单必须指定家庭');
    });

    it('非家庭成员指定 familyId → 403', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-9']);

      await expect(
        service.create('u-1', { ...dto, familyId: 'f-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('分类类型与账单类型不匹配 → 400', async () => {
      prisma.category.findFirst.mockResolvedValue({
        id: 'c-1',
        type: 'income', // 支出账单用了收入分类
      });

      await expect(
        service.create('u-1', dto),
      ).rejects.toThrow('分类类型与账单类型不匹配');
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const original = {
      id: 't-1',
      userId: 'u-1',
      type: TransactionType.expense,
      amount: new Decimal(100),
      accountId: 'a-1',
      categoryId: 'c-1',
      deletedAt: null,
    };

    beforeEach(() => {
      prisma.transaction.findFirst.mockResolvedValue(original);
      prisma.transaction.update.mockResolvedValue({ ...original, amount: new Decimal(30.5) });
    });

    it('金额变更：先回滚原金额，再计入新金额', async () => {
      await service.update('u-1', 't-1', { amount: 30.5 });

      expect(prisma.account.update).toHaveBeenCalledTimes(2);
      // 回滚原支出（视为收入 +100）
      expect(prisma.account.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'a-1' },
        data: { balance: { increment: new Decimal('100') } },
      });
      // 计入新支出 -30.5
      expect(prisma.account.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'a-1' },
        data: { balance: { increment: new Decimal('-30.50') } },
      });
    });

    it('仅更换账户：从原账户回滚，向新账户计入', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-2' });

      await service.update('u-1', 't-1', { accountId: 'a-2' });

      expect(prisma.account.update).toHaveBeenCalledTimes(2);
      expect(prisma.account.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'a-1' },
        data: { balance: { increment: new Decimal('100') } },
      });
      expect(prisma.account.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'a-2' },
        data: { balance: { increment: new Decimal('-100') } },
      });
    });

    it('账单不存在 → 404', async () => {
      prisma.transaction.findFirst.mockResolvedValue(null);

      await expect(service.update('u-1', 't-x', { amount: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne / getSummary（家庭范围隔离）', () => {
    it('findOne 只允许本人或所属家庭的共享账单', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-1']);
      prisma.transaction.findFirst.mockResolvedValue({ id: 't-1' });

      await service.findOne('u-1', 't-1');

      expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { userId: 'u-1' },
              { familyId: { in: ['f-1'] }, isFamilyShared: true },
            ],
          }),
        }),
      );
    });

    it('getSummary 指定非成员家庭 → 403', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-1']);

      await expect(
        service.getSummary('u-1', '2025-01-01', '2025-01-31', 'f-99'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
  it('个人汇总只包含本人的账单', async () => {
    prisma.getUserFamilyIds.mockResolvedValue(['f-1']);
    prisma.transaction.findMany.mockResolvedValue([]);
    await service.getSummary('u-1', '2026-09-01', '2026-09-30');
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u-1');
    expect(where.OR).toBeUndefined();
  });

  it('家庭列表和汇总均包含该家庭所有成员的共享账单', async () => {
    prisma.getUserFamilyIds.mockResolvedValue(['f-1']);
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.count.mockResolvedValue(0);
    await service.findAll('u-1', { familyId: 'f-1' });
    await service.getSummary('u-1', '2026-09-01', '2026-09-30', 'f-1');
    for (const [args] of prisma.transaction.findMany.mock.calls) {
      expect(args.where.familyId).toBe('f-1');
      expect(args.where.isFamilyShared).toBe(true);
      expect(args.where.userId).toBeUndefined();
      expect(args.where.OR).toBeUndefined();
    }
  });

});
