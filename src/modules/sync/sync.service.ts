import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushDataDto } from './dto/push-data.dto';
import { PullDataDto } from './dto/pull-data.dto';
import { ConflictCheckDto, EntityVersionDto } from './dto/conflict-check.dto';
import { ResolveConflictsDto } from './dto/resolve-conflict.dto';
import { RestoreDataDto } from './dto/restore-data.dto';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) { }

  /**
   * 拉取服务器数据
   */
  async pull(userId: string, dto: PullDataDto) {
    const syncTime = new Date();
    const lastSyncAt = new Date(dto.lastSyncAt);

    // 用户所属家庭的共享数据范围（防止跨家庭数据泄露）
    const familyIds = await this.prisma.getUserFamilyIds(userId);

    // 获取所有更新过的数据
    const [transactions, categories, accounts, budgets] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
          updatedAt: { gt: lastSyncAt },
        },
      }),
      this.prisma.category.findMany({
        where: {
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
          updatedAt: { gt: lastSyncAt },
        },
      }),
      this.prisma.account.findMany({
        where: {
          userId,
          updatedAt: { gt: lastSyncAt },
        },
      }),
      this.prisma.budget.findMany({
        where: {
          userId,
          updatedAt: { gt: lastSyncAt },
        },
      }),
    ]);

    // 更新同步日志
    await this.prisma.syncLog.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: dto.deviceId,
        },
      },
      create: {
        userId,
        deviceId: dto.deviceId,
        lastSyncAt: new Date(),
      },
      update: {
        lastSyncAt: new Date(),
      },
    });

    return {
      transactions,
      categories,
      accounts,
      budgets,
      syncTime: syncTime.toISOString(),
    };
  }

  /**
   * 推送本地数据
   */
  async push(userId: string, dto: PushDataDto) {
    const results = {
      transactions: { success: 0, failed: 0, errors: [] as string[] },
      categories: { success: 0, failed: 0, errors: [] as string[] },
      accounts: { success: 0, failed: 0, errors: [] as string[] },
      budgets: { success: 0, failed: 0, errors: [] as string[] },
    };

    // 同步分类
    if (dto.categories?.length) {
      for (const category of dto.categories) {
        try {
          await this.upsertCategory(userId, category);
          results.categories.success++;
        } catch (error: any) {
          results.categories.failed++;
          results.categories.errors.push(`${category.id}: ${error.message}`);
        }
      }
    }

    // 同步账户
    if (dto.accounts?.length) {
      for (const account of dto.accounts) {
        try {
          await this.upsertAccount(userId, account);
          results.accounts.success++;
        } catch (error: any) {
          results.accounts.failed++;
          results.accounts.errors.push(`${account.id}: ${error.message}`);
        }
      }
    }

    // 同步账单
    if (dto.transactions?.length) {
      for (const transaction of dto.transactions) {
        try {
          await this.upsertTransaction(userId, transaction);
          results.transactions.success++;
        } catch (error: any) {
          results.transactions.failed++;
          results.transactions.errors.push(`${transaction.id}: ${error.message}`);
        }
      }
    }

    // 同步预算
    if (dto.budgets?.length) {
      for (const budget of dto.budgets) {
        try {
          await this.upsertBudget(userId, budget);
          results.budgets.success++;
        } catch (error: any) {
          results.budgets.failed++;
          results.budgets.errors.push(`${budget.id}: ${error.message}`);
        }
      }
    }

    // 更新同步日志
    await this.prisma.syncLog.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: dto.deviceId,
        },
      },
      create: {
        userId,
        deviceId: dto.deviceId,
        lastSyncAt: new Date(),
      },
      update: {
        lastSyncAt: new Date(),
      },
    });

    return {
      ...results,
      syncTime: new Date().toISOString(),
    };
  }

  /**
   * 获取冲突数据
   *
   * 冲突判定：自上次成功同步以来，客户端和服务端都修改过同一条记录
   * - 客户端修改：实体版本中的 updatedAt > lastSyncAt
   * - 服务端修改：服务端记录的 updatedAt > lastSyncAt
   */
  async getConflicts(userId: string, dto: ConflictCheckDto) {
    const lastSyncAt = new Date(dto.lastSyncAt);

    // 用户所属家庭的共享数据范围（防止跨家庭数据泄露）
    const familyIds = await this.prisma.getUserFamilyIds(userId);

    const conflicts = {
      transactions: [] as any[],
      categories: [] as any[],
      accounts: [] as any[],
      budgets: [] as any[],
    };

    /**
     * 对比某一类实体的客户端版本与服务端版本
     */
    const check = async (
      clientVersions: EntityVersionDto[] | undefined,
      model: any,
      ownershipWhere: any,
      target: any[],
    ) => {
      if (!clientVersions || clientVersions.length === 0) {
        return;
      }

      const ids = clientVersions.map((v) => v.id);
      const serverRecords = await model.findMany({
        where: { id: { in: ids }, ...ownershipWhere },
      });
      const serverMap = new Map<string, any>(
        serverRecords.map(
          (record: any) => [record.id, record] as [string, any],
        ),
      );

      for (const clientVersion of clientVersions) {
        const server = serverMap.get(clientVersion.id);

        // 客户端自上次同步后修改过，且服务端自上次同步后也修改过 → 冲突
        const clientModified =
          new Date(clientVersion.updatedAt) > lastSyncAt;
        const serverModified = server && server.updatedAt > lastSyncAt;

        if (clientModified && serverModified) {
          target.push({
            id: clientVersion.id,
            client: {
              updatedAt: clientVersion.updatedAt,
              deleted: clientVersion.deleted || false,
            },
            server,
          });
        }
      }
    };

    await Promise.all([
      check(
        dto.transactions,
        this.prisma.transaction,
        {
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
        },
        conflicts.transactions,
      ),
      check(
        dto.categories,
        this.prisma.category,
        {
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
        },
        conflicts.categories,
      ),
      check(dto.accounts, this.prisma.account, { userId }, conflicts.accounts),
      check(dto.budgets, this.prisma.budget, { userId }, conflicts.budgets),
    ]);

    return conflicts;
  }

  /**
   * 解决冲突
   *
   * 每条解决方案：
   * - useServer = true：保留服务器版本（服务器端无需操作）
   * - useServer = false：使用客户端数据覆盖（upsert），账单支持软删除
   */
  async resolveConflicts(userId: string, dto: ResolveConflictsDto) {
    const results = {
      transactions: { success: 0, failed: 0 },
      categories: { success: 0, failed: 0 },
      accounts: { success: 0, failed: 0 },
      budgets: { success: 0, failed: 0 },
    };

    const resolveOne = async (
      resolution: {
        id: string;
        useServer: boolean;
        data?: any;
        deleted?: boolean;
      },
      apply: () => Promise<unknown>,
      target: { success: number; failed: number },
    ) => {
      try {
        if (!resolution.useServer) {
          await apply();
        }
        // useServer=true：服务器版本即最终版本，无需写库
        target.success++;
      } catch {
        target.failed++;
      }
    };

    for (const resolution of dto.transactions || []) {
      await resolveOne(
        resolution,
        async () => {
          if (resolution.deleted) {
            await this.deleteTransaction(userId, resolution.id, resolution.expectedUpdatedAt);
          } else if (resolution.data) {
            if (resolution.id !== resolution.data.id) throw new Error('账单 ID 不一致');
            await this.upsertTransaction(userId, resolution.data, false, true);
          } else {
            throw new Error('缺少客户端数据');
          }
        },
        results.transactions,
      );
    }

    for (const resolution of dto.categories || []) {
      await resolveOne(
        resolution,
        async () => {
          if (!resolution.data) {
            throw new Error('缺少客户端数据');
          }
          await this.upsertCategory(userId, resolution.data);
        },
        results.categories,
      );
    }

    for (const resolution of dto.accounts || []) {
      await resolveOne(
        resolution,
        async () => {
          if (!resolution.data) {
            throw new Error('缺少客户端数据');
          }
          await this.upsertAccount(userId, resolution.data);
        },
        results.accounts,
      );
    }

    for (const resolution of dto.budgets || []) {
      await resolveOne(
        resolution,
        async () => {
          if (!resolution.data) {
            throw new Error('缺少客户端数据');
          }
          await this.upsertBudget(userId, resolution.data);
        },
        results.budgets,
      );
    }

    return results;
  }

  /** 只恢复当前账号缺失的记录，不覆盖服务端数据或家庭成员关系。 */
  async restore(userId: string, dto: RestoreDataDto) {
    if (dto.ownerId !== userId) throw new ForbiddenException('只能恢复当前账号的备份');
    const results = {
      categories: { success: 0, failed: 0, skipped: 0 },
      accounts: { success: 0, failed: 0, skipped: 0 },
      transactions: { success: 0, failed: 0, skipped: 0 },
      budgets: { success: 0, failed: 0, skipped: 0 },
    };
    const apply = async (kind: keyof typeof results, records: any[], save: (record: any) => Promise<unknown>) => {
      for (const record of records) {
        try {
          const result = await save(record);
          results[kind][result === false ? 'skipped' : 'success']++;
        } catch {
          results[kind].failed++;
        }
      }
    };
    await apply('categories', dto.categories ?? [], data => this.upsertCategory(userId, data, true));
    // 快照余额已经包含账单，先还原期初余额，再由账单恢复逐笔入账。
    const netByAccount = new Map<string, Decimal>();
    const seen = new Set<string>();
    for (const record of dto.transactions ?? []) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      const delta = new Decimal(record.amount).mul(record.type === 'income' ? 1 : -1);
      netByAccount.set(record.accountId, (netByAccount.get(record.accountId) ?? new Decimal(0)).add(delta));
    }
    await apply('accounts', dto.accounts ?? [], data => this.upsertAccount(userId, {
      ...data, balance: new Decimal(data.balance).sub(netByAccount.get(data.id) ?? 0).toNumber(),
    }, true));
    await apply('transactions', dto.transactions ?? [], data => this.upsertTransaction(userId, data, true));
    await apply('budgets', dto.budgets ?? [], data => this.upsertBudget(userId, data, true));
    return results;
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus(userId: string, deviceId: string) {
    const syncLog = await this.prisma.syncLog.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
    });

    return {
      lastSyncAt: syncLog?.lastSyncAt || null,
      deviceId,
    };
  }

  /**
   * 更新或创建账单
   */
  private async upsertTransaction(userId: string, data: any, onlyMissing = false, allowRevive = false) {
    // 归属校验：推送带 familyId 的数据必须是该家庭成员
    if (data.familyId) {
      const membership = await this.prisma.familyMember.findFirst({
        where: { familyId: data.familyId, userId },
      });
      if (!membership) {
        throw new Error('不是该家庭成员，无权写入家庭账单');
      }
    }

    if (data.isFamilyShared && !data.familyId) throw new Error('家庭共享账单必须指定家庭');
    const familyIds = await this.prisma.getUserFamilyIds(userId);
    // 引用校验：分类/账户必须是本人或家庭共享的
    const [category, account] = await Promise.all([
      this.prisma.category.findFirst({
        where: {
          id: data.categoryId,
          OR: [{ userId }, { familyId: { in: familyIds }, isFamilyShared: true }],
        },
      }),
      this.prisma.account.findFirst({
        where: { id: data.accountId, userId },
      }),
    ]);
    if (!category) {
      throw new Error('分类不存在或无权使用');
    }
    if (!account) {
      throw new Error('账户不存在或无权使用');
    }

    if (category.type !== data.type) throw new Error('分类类型与账单类型不匹配');
    if (category.familyId && category.familyId !== data.familyId) {
      throw new Error('分类不属于该账本');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id: data.id } });
      if (existing && existing.userId !== userId) throw new Error('无权更新他人的账单');
      if (existing && onlyMissing) return false;
      if (existing?.deletedAt && !allowRevive) {
        throw new Error('账单已删除，请先处理同步冲突');
      }
      if (data.expectedUpdatedAt) {
        const expected = new Date(data.expectedUpdatedAt).getTime();
        if (existing && existing.updatedAt.getTime() !== expected) {
          // 网络响应丢失后的同内容重试可直接成功，不能再扣款或推进版本。
          if (!existing.deletedAt && this.sameTransaction(existing, data)) return existing;
          throw new Error('服务端账单已变更，请先处理同步冲突');
        }
        if (!existing && expected !== 0) throw new Error('服务端账单已不存在');
      }
      const result = await tx.transaction.upsert({
        where: { id: data.id },
        create: {
          id: data.id,
          userId,
          familyId: data.familyId,
          type: data.type,
          amount: new Decimal(data.amount),
          categoryId: data.categoryId,
          subCategoryId: data.subCategoryId,
          accountId: data.accountId,
          date: new Date(data.date),
          note: data.note,
          tags: data.tags || [],
          location: data.location,
          isFamilyShared: data.isFamilyShared || false,
        },
        update: {
          familyId: data.familyId ?? null,
          deletedAt: null,
          type: data.type,
          amount: new Decimal(data.amount),
          categoryId: data.categoryId,
          subCategoryId: data.subCategoryId,
          accountId: data.accountId,
          date: new Date(data.date),
          note: data.note,
          tags: data.tags || [],
          location: data.location,
          isFamilyShared: data.isFamilyShared || false,
        },
      });
      if (existing && !existing.deletedAt) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { increment: new Decimal(existing.amount).mul(existing.type === 'income' ? -1 : 1) } },
        });
      }
      await tx.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: new Decimal(data.amount).mul(data.type === 'income' ? 1 : -1) } },
      });
      return result;
    }, { isolationLevel: 'Serializable' });
  }

  private sameTransaction(existing: any, data: any): boolean {
    return existing.type === data.type &&
      new Decimal(existing.amount).eq(data.amount) &&
      existing.accountId === data.accountId &&
      existing.categoryId === data.categoryId &&
      (existing.familyId ?? null) === (data.familyId ?? null) &&
      (existing.subCategoryId ?? null) === (data.subCategoryId ?? null) &&
      existing.date.getTime() === new Date(data.date).getTime() &&
      (existing.note ?? null) === (data.note ?? null) &&
      (existing.location ?? null) === (data.location ?? null) &&
      existing.isFamilyShared === (data.isFamilyShared ?? false) &&
      JSON.stringify(existing.tags) === JSON.stringify(data.tags ?? []);
  }

  private async deleteTransaction(userId: string, id: string, expectedUpdatedAt?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) throw new Error('账单不存在或无权删除');
      if (existing.deletedAt) return;
      if (expectedUpdatedAt && existing.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
        throw new Error('服务端账单已变更，请先处理同步冲突');
      }
      await tx.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: new Decimal(existing.amount).mul(existing.type === 'income' ? -1 : 1) } },
      });
    }, { isolationLevel: 'Serializable' });
  }

  /**
   * 更新或创建分类
   */
  private async upsertCategory(userId: string, data: any, onlyMissing = false) {
    // 归属校验：推送带 familyId 的数据必须是该家庭成员
    if (data.familyId) {
      const membership = await this.prisma.familyMember.findFirst({
        where: { familyId: data.familyId, userId },
      });
      if (!membership) {
        throw new Error('不是该家庭成员，无权写入家庭分类');
      }
    }

    // 归属校验：已存在的记录只能由本人更新
    const existing = await this.prisma.category.findUnique({
      where: { id: data.id },
    });
    if (existing && existing.userId !== userId) {
      throw new Error('无权更新他人的分类');
    }

    if (existing && onlyMissing) return false;
    const args = {
      where: { id: data.id },
      create: {
        id: data.id,
        userId,
        familyId: data.familyId,
        name: data.name,
        type: data.type,
        icon: data.icon,
        color: data.color,
        sortOrder: data.sortOrder || 0,
        isFamilyShared: data.isFamilyShared || false,
      },
      update: {
        name: data.name,
        type: data.type,
        icon: data.icon,
        color: data.color,
        sortOrder: data.sortOrder,
        isFamilyShared: data.isFamilyShared,
      },
    };
    return onlyMissing
      ? this.prisma.category.create({ data: args.create })
      : this.prisma.category.upsert(args);
  }

  /**
   * 更新或创建账户
   */
  private async upsertAccount(userId: string, data: any, onlyMissing = false) {
    // 归属校验：已存在的记录只能由本人更新
    const existing = await this.prisma.account.findUnique({
      where: { id: data.id },
    });
    if (existing && existing.userId !== userId) {
      throw new Error('无权更新他人的账户');
    }

    if (existing && onlyMissing) return false;
    const args = {
      where: { id: data.id },
      create: {
        id: data.id,
        userId,
        name: data.name,
        type: data.type,
        balance: new Decimal(data.balance || 0),
        icon: data.icon,
        color: data.color,
        note: data.note,
        sortOrder: data.sortOrder || 0,
        isIncludedInTotal: data.isIncludedInTotal ?? true,
      },
      update: {
        name: data.name,
        type: data.type,
        balance: new Decimal(data.balance),
        icon: data.icon,
        color: data.color,
        note: data.note,
        sortOrder: data.sortOrder,
        isIncludedInTotal: data.isIncludedInTotal,
      },
    };
    return onlyMissing
      ? this.prisma.account.create({ data: args.create })
      : this.prisma.account.upsert(args);
  }

  /**
   * 更新或创建预算
   */
  private async upsertBudget(userId: string, data: any, onlyMissing = false) {
    // 归属校验：推送带 familyId 的数据必须是该家庭成员
    if (data.familyId) {
      const membership = await this.prisma.familyMember.findFirst({
        where: { familyId: data.familyId, userId },
      });
      if (!membership) {
        throw new Error('不是该家庭成员，无权写入家庭预算');
      }
    }

    // 归属校验：已存在的记录只能由本人更新
    const existing = await this.prisma.budget.findUnique({
      where: { id: data.id },
    });
    if (existing && existing.userId !== userId) {
      throw new Error('无权更新他人的预算');
    }

    if (existing && onlyMissing) return false;
    if (data.categoryId) {
      const familyIds = await this.prisma.getUserFamilyIds(userId);
      const category = await this.prisma.category.findFirst({
        where: {
          id: data.categoryId,
          OR: [{ userId }, { familyId: { in: familyIds }, isFamilyShared: true }],
        }
      });
      if (!category) throw new Error('分类不存在或无权使用');
      if (category.familyId && category.familyId !== data.familyId) {
        throw new Error('分类不属于该账本');
      }
    }
    const args = {
      where: { id: data.id },
      create: {
        id: data.id,
        userId,
        familyId: data.familyId,
        amount: new Decimal(data.amount),
        period: data.period,
        categoryId: data.categoryId,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        isActive: data.isActive ?? true,
      },
      update: {
        amount: new Decimal(data.amount),
        period: data.period,
        categoryId: data.categoryId,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        isActive: data.isActive,
      },
    };
    return onlyMissing
      ? this.prisma.budget.create({ data: args.create })
      : this.prisma.budget.upsert(args);
  }

}
