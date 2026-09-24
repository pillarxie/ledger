import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { BatchTransactionDto } from './dto/batch-transaction.dto';
import { TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import {
  assertValidDateRange,
  createPaginatedResponse,
  endOfDay,
} from '../../common/utils';

/** 余额操作的数据库客户端（PrismaService 或交互式事务客户端） */
type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) { }

  /**
   * 创建账单
   */
  async create(userId: string, dto: CreateTransactionDto) {
    // 家庭共享账单必须归属某个家庭
    if (dto.isFamilyShared && !dto.familyId) {
      throw new BadRequestException('家庭共享账单必须指定家庭');
    }

    const familyIds = await this.prisma.getUserFamilyIds(userId);

    // 验证账户归属
    const account = await this.prisma.account.findFirst({
      where: { id: dto.accountId, userId },
    });
    if (!account) {
      throw new NotFoundException('账户不存在');
    }

    // 验证分类：本人分类或所属家庭的共享分类
    const category = await this.prisma.category.findFirst({
      where: {
        id: dto.categoryId,
        OR: [
          { userId },
          { familyId: { in: familyIds }, isFamilyShared: true },
        ],
      },
    });
    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    if (category.familyId && category.familyId !== dto.familyId) {
      throw new BadRequestException('分类不属于该账本');
    }

    // 分类类型必须与账单类型一致
    if (category.type !== dto.type) {
      throw new BadRequestException('分类类型与账单类型不匹配');
    }

    // 如果关联家庭，验证用户是否是家庭成员
    if (dto.familyId && !familyIds.includes(dto.familyId)) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    // 创建账单 + 原子更新账户余额，保证一致性
    const transaction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId,
          familyId: dto.familyId,
          type: dto.type,
          amount: new Decimal(dto.amount.toFixed(2)),
          categoryId: dto.categoryId,
          subCategoryId: dto.subCategoryId,
          accountId: dto.accountId,
          date: new Date(dto.date),
          note: dto.note,
          tags: dto.tags || [],
          location: dto.location,
          isFamilyShared: dto.isFamilyShared ?? false,
        },
        include: {
          category: true,
          account: true,
        },
      });

      await this.updateAccountBalance(tx, dto.accountId, dto.type, dto.amount);
      return created;
    });

    return transaction;
  }

  /**
   * 获取账单列表（分页）
   */
  async findAll(userId: string, query: QueryTransactionDto) {
    const {
      page = 1,
      pageSize = 20,
      startDate,
      endDate,
      type,
      categoryId,
      accountId,
      familyId,
    } = query;

    // 分页参数收敛到安全范围
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);

    // 日期范围校验
    assertValidDateRange(startDate, endDate);

    const where: any = {
      userId,
      deletedAt: null,
    };

    // 时间范围（endDate 归一化为当天最后一毫秒，包含结束日全天）
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = endOfDay(endDate);
    }

    // 类型筛选
    if (type) {
      where.type = type;
    }

    // 分类筛选
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // 账户筛选
    if (accountId) {
      where.accountId = accountId;
    }

    // 家庭筛选（验证成员身份，与 findOne/getSummary 语义一致）
    if (familyId) {
      const familyIds = await this.prisma.getUserFamilyIds(userId);
      if (!familyIds.includes(familyId)) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
      delete where.userId;
      where.familyId = familyId;
      where.isFamilyShared = true;
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          category: true,
          account: true,
        },
        orderBy: { date: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return createPaginatedResponse(items, safePage, safePageSize, total);
  }

  /**
   * 获取账单详情
   */
  async findOne(userId: string, id: string) {
    const familyIds = await this.prisma.getUserFamilyIds(userId);

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { userId },
          { familyId: { in: familyIds }, isFamilyShared: true },
        ],
      },
      include: {
        category: true,
        account: true,
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('账单不存在');
    }

    return transaction;
  }

  /**
   * 更新账单
   */
  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    // 查找账单（仅限本人、未删除）
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!transaction) {
      throw new NotFoundException('账单不存在');
    }

    // 新值：未提供的字段保持原值
    const nextAmount = dto.amount ?? Number(transaction.amount);
    const nextType = dto.type ?? transaction.type;
    const nextAccountId = dto.accountId ?? transaction.accountId;
    const nextFamilyId =
      dto.familyId !== undefined ? dto.familyId : transaction.familyId;
    const nextIsFamilyShared =
      dto.isFamilyShared ?? transaction.isFamilyShared;

    // 家庭共享账单必须归属某个家庭
    if (nextIsFamilyShared && !nextFamilyId) {
      throw new BadRequestException('家庭共享账单必须指定家庭');
    }

    // 更换家庭归属时验证成员身份
    if (dto.familyId && dto.familyId !== transaction.familyId) {
      const familyIds = await this.prisma.getUserFamilyIds(userId);
      if (!familyIds.includes(dto.familyId)) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
    }

    // 如果更换账户，验证账户归属
    if (dto.accountId && dto.accountId !== transaction.accountId) {
      const account = await this.prisma.account.findFirst({
        where: { id: dto.accountId, userId },
      });
      if (!account) {
        throw new NotFoundException('账户不存在');
      }
    }

    // 更换分类或类型时：校验分类可用性且类型匹配
    const categoryChanged =
      dto.categoryId !== undefined && dto.categoryId !== transaction.categoryId;
    if (categoryChanged || dto.type !== undefined || dto.familyId !== undefined) {
      const targetCategoryId = dto.categoryId ?? transaction.categoryId;
      const familyIds = await this.prisma.getUserFamilyIds(userId);
      const category = await this.prisma.category.findFirst({
        where: {
          id: targetCategoryId,
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
        },
      });
      if (!category) {
        throw new NotFoundException('分类不存在');
      }
      if (category.familyId && category.familyId !== nextFamilyId) {
        throw new BadRequestException('分类不属于该账本');
      }
      if (category.type !== nextType) {
        throw new BadRequestException('分类类型与账单类型不匹配');
      }
    }

    // 金额/类型/账户任一变化 → 同步调整账户余额
    const balanceChanged =
      dto.amount !== undefined ||
      dto.type !== undefined ||
      dto.accountId !== undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.transaction.update({
        where: { id },
        data: {
          ...dto,
          amount: dto.amount !== undefined ? new Decimal(dto.amount.toFixed(2)) : undefined,
          date: dto.date ? new Date(dto.date) : undefined,
        },
        include: {
          category: true,
          account: true,
        },
      });

      if (balanceChanged) {
        // 回滚原账单对原账户的影响
        await this.updateAccountBalance(
          tx,
          transaction.accountId,
          transaction.type === TransactionType.income
            ? TransactionType.expense
            : TransactionType.income,
          Number(transaction.amount),
        );
        // 计入新账单对新账户的影响（账户变化时同样正确迁移余额）
        await this.updateAccountBalance(tx, nextAccountId, nextType, nextAmount);
      }

      return record;
    });

    return updated;
  }

  /**
   * 删除账单（软删除）
   */
  async remove(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!transaction) {
      throw new NotFoundException('账单不存在');
    }

    // 软删除 + 原子回滚账户余额
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.updateAccountBalance(
        tx,
        transaction.accountId,
        transaction.type === TransactionType.income
          ? TransactionType.expense
          : TransactionType.income,
        Number(transaction.amount),
      );
    });

    return { message: '删除成功' };
  }

  /**
   * 批量操作
   */
  async batch(userId: string, dto: BatchTransactionDto) {
    const results = [];

    for (const id of dto.ids) {
      try {
        if (dto.action === 'delete') {
          await this.remove(userId, id);
          results.push({ id, success: true });
        }
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * 获取收支汇总
   */
  async getSummary(
    userId: string,
    startDate: string,
    endDate: string,
    familyId?: string,
  ) {
    assertValidDateRange(startDate, endDate);

    const familyIds = await this.prisma.getUserFamilyIds(userId);

    // 指定家庭时必须验证成员身份
    if (familyId && !familyIds.includes(familyId)) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    const where: any = {
      ...(familyId ? { familyId, isFamilyShared: true } : { userId }),
      deletedAt: null,
      date: {
        gte: new Date(startDate),
        lte: endOfDay(endDate),
      },
    };

    if (familyId) {
      delete where.userId;
      where.familyId = familyId;
      where.isFamilyShared = true;
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    for (const t of transactions) {
      const amount = Number(t.amount);
      if (t.type === TransactionType.income) {
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }
    }

    // 统一两位小数，消除浮点累加误差
    return {
      totalIncome: Number(totalIncome.toFixed(2)),
      totalExpense: Number(totalExpense.toFixed(2)),
      balance: Number((totalIncome - totalExpense).toFixed(2)),
      transactionCount: transactions.length,
    };
  }

  /**
   * 原子更新账户余额（收入增加、支出减少）
   */
  private async updateAccountBalance(
    client: DbClient,
    accountId: string,
    type: TransactionType,
    amount: number,
  ) {
    const delta = new Decimal(
      type === TransactionType.income ? amount.toFixed(2) : (-amount).toFixed(2),
    );

    await client.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }
}
