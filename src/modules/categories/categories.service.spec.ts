import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../../prisma/prisma.service';

function buildPrismaMock(): any {
  return {
    getUserFamilyIds: jest.fn().mockResolvedValue([]),
    familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
    category: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      count: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(buildPrismaMock());
      }
      return Promise.all(arg);
    }),
  };
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  describe('findAll（跨家庭隔离）', () => {
    it('只返回本人分类与所属家庭的共享分类', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-1']);

      await service.findAll('u-1');

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { userId: 'u-1', familyId: null },
              { familyId: { in: ['f-1'] }, isFamilyShared: true },
            ],
          },
        }),
      );
    });

    it('指定非成员家庭 → 403', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-1']);

      await expect(service.findAll('u-1', undefined, 'f-99')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findOne（跨家庭隔离）', () => {
    it('非本人且非所属家庭的共享分类 → 404', async () => {
      prisma.getUserFamilyIds.mockResolvedValue(['f-1']);
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(service.findOne('u-1', 'c-x')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.category.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'c-x',
          OR: [
            { userId: 'u-1' },
            { familyId: { in: ['f-1'] }, isFamilyShared: true },
          ],
        },
      });
    });
  });

  describe('create（家庭归属校验）', () => {
    it('非成员创建家庭分类 → 403', async () => {
      prisma.familyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.create('u-1', {
          familyId: 'f-99',
          name: '家庭分类',
          type: 'expense' as any,
          icon: 'x',
          color: '#000',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });
  });

  describe('update（家庭归属与重名校验）', () => {
    it('更换为非成员家庭 → 403', async () => {
      prisma.category.findFirst
        .mockResolvedValueOnce({ id: 'c-1', userId: 'u-1', familyId: null, name: '餐饮', type: 'expense' })
        .mockResolvedValueOnce(null); // 后续重名检查不命中
      prisma.familyMember.findFirst.mockResolvedValue(null);

      await expect(
        service.update('u-1', 'c-1', { familyId: 'f-99' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('同家庭内跨成员重名 → 409', async () => {
      prisma.category.findFirst
        .mockResolvedValueOnce({ id: 'c-1', userId: 'u-1', familyId: 'f-1', name: '餐饮', type: 'expense' })
        // assertCategoryNameAvailable：家庭共享范围命中其他成员的同名分类
        .mockResolvedValueOnce({ id: 'c-2', userId: 'u-2' });
      prisma.familyMember.findFirst.mockResolvedValue({ id: 'm-1' });

      await expect(
        service.update('u-1', 'c-1', { name: '交通' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reorder（校验所有 ID 归属）', () => {
    it('存在无权排序的分类 → 404', async () => {
      prisma.category.count.mockResolvedValue(1); // 请求 2 个，只有 1 个属于用户

      await expect(
        service.reorder('u-1', {
          orders: [
            { id: 'c-1', sortOrder: 0 },
            { id: 'c-2', sortOrder: 1 },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.category.updateMany).not.toHaveBeenCalled();
    });

    it('重复 sortOrder → 409', async () => {
      prisma.category.count.mockResolvedValue(2);

      await expect(
        service.reorder('u-1', {
          orders: [
            { id: 'c-1', sortOrder: 1 },
            { id: 'c-2', sortOrder: 1 },
          ],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.category.updateMany).not.toHaveBeenCalled();
    });

    it('全部属于用户 → 执行排序', async () => {
      prisma.category.count.mockResolvedValue(2);
      prisma.category.updateMany.mockResolvedValue({ count: 1 });

      await service.reorder('u-1', {
        orders: [
          { id: 'c-1', sortOrder: 1 },
          { id: 'c-2', sortOrder: 0 },
        ],
      });

      expect(prisma.category.updateMany).toHaveBeenCalledTimes(2);
    });
  });
});
