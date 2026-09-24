import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { lastValueFrom, of } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { RestoreDataDto } from './dto/restore-data.dto';
import { PushDataDto } from './dto/push-data.dto';

// 与 main.ts 相同的 DTO 管道和响应转换，使用真实 controller/service，不写数据库。
describe('Sync controller contracts', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  let controller: SyncController;
  let prisma: any;
  const transaction = { id: 't1', type: 'expense', amount: 12.5, categoryId: 'c1', accountId: 'a1', date: '2026-09-24', note: null, familyId: null, subCategoryId: null, location: null, tags: [], isFamilyShared: false };
  beforeEach(async () => {
    prisma = {
      getUserFamilyIds: jest.fn().mockResolvedValue([]),
      category: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', type: 'expense', userId: 'u1' }) },
      account: { findFirst: jest.fn().mockResolvedValue({ id: 'a1', userId: 'u1' }), update: jest.fn() },
      transaction: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 't1' }) },
      syncLog: { upsert: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };
    const module = await Test.createTestingModule({ controllers: [SyncController], providers: [SyncService, { provide: PrismaService, useValue: prisma }] }).compile();
    controller = module.get(SyncController);
  });

  it('接受前端白名单 DTO 的 null 和金额字段，service 使用 Decimal', async () => {
    const dto = await pipe.transform({ ownerId: 'u1', deviceId: 'dev', transactions: [transaction] }, { type: 'body', metatype: RestoreDataDto });
    const result = await controller.restore('u1', dto);
    expect(result.transactions.success).toBe(1);
    const stored = prisma.transaction.upsert.mock.calls[0][0].create;
    expect(stored.amount).toBeInstanceOf(Decimal);
    const interceptor = new TransformInterceptor<{ amount: number }>();
    const response = await lastValueFrom(interceptor.intercept({} as any, { handle: () => of(stored) }));
    expect(response.data.amount).toBe(12.5);
    expect(typeof response.data.amount).toBe('number');
  });

  it('拒绝额外 userId 防止快照绕过用户作用域', async () => {
    await expect(pipe.transform({ ownerId: 'u1', deviceId: 'dev', transactions: [{ ...transaction, userId: 'u2' }] }, { type: 'body', metatype: RestoreDataDto })).rejects.toThrow();
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
  });

  it('拒绝非数字和超出分币精度的金额', async () => {
    for (const amount of ['12.50', 1.234, -1]) {
      await expect(pipe.transform({ deviceId: 'dev', transactions: [{ ...transaction, amount }] }, { type: 'body', metatype: PushDataDto })).rejects.toThrow();
    }
  });

  it('普通 push 不自动复活已删除账单', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ ...transaction, userId: 'u1', deletedAt: new Date() });
    const result = await controller.push('u1', { deviceId: 'dev', transactions: [transaction] } as any);
    expect(result.transactions.failed).toBe(1);
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
  });

  it('共享分类不能跨家庭绑定', async () => {
    prisma.category.findFirst.mockResolvedValue({ id: 'c1', type: 'expense', userId: 'u2', familyId: 'family-other' });
    const result = await controller.push('u1', { deviceId: 'dev', transactions: [transaction] } as any);
    expect(result.transactions.failed).toBe(1);
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
  });
  it('CAS rejects a newer server version inside transaction without touching balance', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ ...transaction, amount: new Decimal(99), userId: 'u1', updatedAt: new Date('2026-09-24T10:00:00Z'), date: new Date('2026-09-24'), deletedAt: null });
    const result = await controller.push('u1', { deviceId: 'dev', transactions: [{ ...transaction, expectedUpdatedAt: '2026-09-24T09:00:00Z' }] } as any);
    expect(result.transactions.failed).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('CAS accepts exact retry of a newly uploaded UUID without advancing version or balance', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ ...transaction, userId: 'u1', updatedAt: new Date('2026-09-24T10:00:00Z'), date: new Date('2026-09-24'), deletedAt: null });
    const result = await controller.push('u1', { deviceId: 'dev', transactions: [{ ...transaction, expectedUpdatedAt: '1970-01-01T00:00:00Z' }] } as any);
    expect(result.transactions.success).toBe(1);
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('CAS refuses deleting a newer server version', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ ...transaction, userId: 'u1', updatedAt: new Date('2026-09-24T10:00:00Z'), deletedAt: null });
    const result = await controller.resolveConflicts('u1', { transactions: [{ id: 't1', useServer: false, deleted: true, expectedUpdatedAt: '2026-09-24T09:00:00Z' }] });
    expect(result.transactions.failed).toBe(1);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

});
