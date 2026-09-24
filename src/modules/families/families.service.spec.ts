import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionType } from '@prisma/client';
import { FamiliesService } from './families.service';
import { PrismaService } from '../../prisma/prisma.service';
import { endOfDay } from '../../common/utils';

function buildPrismaMock() {
  return {
    family: {
      findUnique: jest.fn(),
    },
    familyMember: {
      findFirst: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
    },
  };
}

function buildConfigMock() {
  return { get: jest.fn((key: string, fallback?: unknown) => fallback) };
}

describe('FamiliesService.getStatistics', () => {
  let service: FamiliesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  const userId = 'u-1';
  const familyId = 'f-1';

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FamiliesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: buildConfigMock() },
      ],
    }).compile();

    service = module.get(FamiliesService);
  });

  it('非家庭成员 → ForbiddenException', async () => {
    prisma.familyMember.findFirst.mockResolvedValue(null);

    await expect(
      service.getStatistics(userId, familyId),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.getStatistics(userId, familyId),
    ).rejects.toThrow('您不是该家庭的成员');
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('成员：正确汇总分类占比、月度趋势与成员收支', async () => {
    prisma.familyMember.findFirst.mockResolvedValue({ id: 'm-1' });
    prisma.transaction.findMany.mockResolvedValue([
      {
        type: TransactionType.expense,
        amount: 50,
        date: new Date('2025-01-15T10:00:00Z'),
        userId: 'u-1',
        category: { id: 'c-1', name: '餐饮', icon: 'food', color: '#FF5722' },
      },
      {
        type: TransactionType.expense,
        amount: 150,
        date: new Date('2025-01-20T10:00:00Z'),
        userId: 'u-2',
        category: { id: 'c-1', name: '餐饮', icon: 'food', color: '#FF5722' },
      },
      {
        type: TransactionType.income,
        amount: 1000,
        date: new Date('2025-02-01T10:00:00Z'),
        userId: 'u-1',
        category: { id: 'c-2', name: '工资', icon: 'salary', color: '#4CAF50' },
      },
    ]);

    const result = await service.getStatistics(userId, familyId);

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          familyId,
          isFamilyShared: true,
          deletedAt: null,
        },
      }),
    );

    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpense).toBe(200);
    expect(result.balance).toBe(800);
    expect(result.transactionCount).toBe(3);

    // 分类占比按金额降序
    expect(result.categoryBreakdown).toHaveLength(2);
    expect(result.categoryBreakdown[0]).toEqual({
      categoryId: 'c-2',
      name: '工资',
      icon: 'salary',
      color: '#4CAF50',
      income: 1000,
      expense: 0,
    });
    expect(result.categoryBreakdown[1]).toEqual({
      categoryId: 'c-1',
      name: '餐饮',
      icon: 'food',
      color: '#FF5722',
      income: 0,
      expense: 200,
    });

    // 月度趋势按月份升序
    expect(result.monthlyTrend).toEqual([
      { month: '2025-01', income: 0, expense: 200 },
      { month: '2025-02', income: 1000, expense: 0 },
    ]);

    // 成员收支
    expect(result.memberStats).toEqual({
      'u-1': { income: 1000, expense: 50 },
      'u-2': { income: 0, expense: 150 },
    });
  });

  it('传入时间范围时，where.date 附带 gte/lte 条件', async () => {
    prisma.familyMember.findFirst.mockResolvedValue({ id: 'm-1' });
    prisma.transaction.findMany.mockResolvedValue([]);

    await service.getStatistics(
      userId,
      familyId,
      '2025-01-01',
      '2025-01-31',
    );

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          familyId,
          isFamilyShared: true,
          deletedAt: null,
          date: {
            gte: new Date('2025-01-01'),
            lte: endOfDay('2025-01-31'),
          },
        },
      }),
    );
  });
});
