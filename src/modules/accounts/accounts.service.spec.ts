import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';

function buildPrismaMock() {
  const prisma: any = {
    account: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    transaction: {
      count: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return Promise.all(arg);
    }),
  };
  return prisma;
}

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AccountsService);
  });

  describe('transfer', () => {
    const dto = { fromAccountId: 'a-1', toAccountId: 'a-2', amount: 200.5 };

    beforeEach(() => {
      prisma.account.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve({ id: where.id }),
      );
      prisma.account.updateMany.mockResolvedValue({ count: 1 });
    });

    it('正常转账：原子扣减源账户并增加目标账户', async () => {
      await service.transfer('u-1', dto);

      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'a-1',
          userId: 'u-1',
          balance: { gte: new Decimal('200.50') },
        },
        data: { balance: { decrement: new Decimal('200.50') } },
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'a-2' },
        data: { balance: { increment: new Decimal('200.50') } },
      });
    });

    it('余额不足：扣减影响行数为 0 → 400，且目标账户不变', async () => {
      prisma.account.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.transfer('u-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('自转账 → 400', async () => {
      await expect(
        service.transfer('u-1', { ...dto, toAccountId: 'a-1' }),
      ).rejects.toThrow('源账户和目标账户不能相同');
      expect(prisma.account.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('只统计未删除的账单（软删除的不阻止删除）', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.transaction.count.mockResolvedValue(0);
      prisma.account.delete.mockResolvedValue({});

      await service.remove('u-1', 'a-1');

      expect(prisma.transaction.count).toHaveBeenCalledWith({
        where: { accountId: 'a-1', deletedAt: null },
      });
    });

    it('有未删除账单 → 409', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.transaction.count.mockResolvedValue(3);

      await expect(service.remove('u-1', 'a-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.account.delete).not.toHaveBeenCalled();
    });
  });
});
