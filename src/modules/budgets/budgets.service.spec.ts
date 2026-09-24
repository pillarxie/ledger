import { Test, TestingModule } from '@nestjs/testing';
import { BudgetsService } from './budgets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BudgetPeriod, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';

function buildPrismaMock(): any {
  return {
    getUserFamilyIds: jest.fn().mockResolvedValue(['f-1']),
    familyMember: { findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    category: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
    budget: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    transaction: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(buildPrismaMock());
      }
      return Promise.all(arg);
    }),
  };
}

describe('BudgetsService', () => {
  let service: BudgetsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BudgetsService);
  });

  describe('getProgress', () => {
    const familyBudget = {
      id: 'b-1',
      userId: 'u-1',
      familyId: 'f-1',
      amount: new Decimal(1000),
      period: BudgetPeriod.monthly,
      categoryId: null,
      startDate: new Date('2025-01-01'),
      endDate: null,
      isActive: true,
      category: null,
    };

    it('家庭预算：统计所有家庭成员的共享支出（不带 userId 过滤）', async () => {
      prisma.budget.findFirst.mockResolvedValue(familyBudget);
      prisma.transaction.groupBy.mockResolvedValue([
        { categoryId: 'c-1', _sum: { amount: new Decimal(300) } },
        { categoryId: 'c-2', _sum: { amount: new Decimal(200) } },
      ]);

      const result = await service.getProgress('u-1', 'b-1');

      expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            familyId: 'f-1',
            isFamilyShared: true,
            type: TransactionType.expense,
            deletedAt: null,
          }),
        }),
      );
      // where 不包含 userId
      expect(
        prisma.transaction.groupBy.mock.calls[0][0].where.userId,
      ).toBeUndefined();

      expect(result.spent).toBe(500);
      expect(result.remaining).toBe(500);
      expect(result.percentage).toBe(50);
      expect(result.isOverBudget).toBe(false);
    });

    it('个人预算：只统计本人支出', async () => {
      prisma.budget.findFirst.mockResolvedValue({ ...familyBudget, familyId: null });
      prisma.transaction.groupBy.mockResolvedValue([
        { categoryId: null, _sum: { amount: new Decimal(400) } },
      ]);

      const result = await service.getProgress('u-1', 'b-1');

      expect(prisma.transaction.groupBy.mock.calls[0][0].where).toMatchObject({
        userId: 'u-1',
      });
      expect(result.spent).toBe(400);
    });

    it('超出预算 → isOverBudget=true，percentage 封顶 100', async () => {
      prisma.budget.findFirst.mockResolvedValue(familyBudget);
      prisma.transaction.groupBy.mockResolvedValue([
        { categoryId: null, _sum: { amount: new Decimal(1200) } },
      ]);

      const result = await service.getProgress('u-1', 'b-1');

      expect(result.spent).toBe(1200);
      expect(result.isOverBudget).toBe(true);
      expect(result.percentage).toBe(100);
    });
  });
  it('预算列表包含停用预算，个人账本不混家庭预算', async () => {
    await service.findAll('u-1');
    expect(prisma.budget.findMany.mock.calls[0][0].where).toEqual({ userId: 'u-1', familyId: null });
  });

  it('启用预算时检查相同周期分类的冲突', async () => {
    prisma.budget.findFirst.mockResolvedValueOnce({ id: 'b-1', familyId: null, categoryId: null, period: 'monthly', isActive: false }).mockResolvedValueOnce({ id: 'b-2' });
    await expect(service.update('u-1', 'b-1', { isActive: true })).rejects.toThrow('已存在相同分类');
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

  it('删除预算使用真实删除，停用状态不会混同删除', async () => {
    prisma.budget.findFirst.mockResolvedValue({ id: 'b-1' });
    await service.remove('u-1', 'b-1');
    expect(prisma.budget.delete).toHaveBeenCalledWith({ where: { id: 'b-1' } });
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

});
