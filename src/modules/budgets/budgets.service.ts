import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { Budget, BudgetPeriod, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { createPaginatedResponse, endOfDay } from '../../common/utils';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) { }

  /**
   * 创建预算
   */
  async create(userId: string, dto: CreateBudgetDto) {
    // 如果关联家庭，验证用户是否是家庭成员
    if (dto.familyId) {
      const member = await this.prisma.familyMember.findFirst({
        where: { familyId: dto.familyId, userId },
      });
      if (!member) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
    }

    // 如果指定分类，验证分类可用性（本人或所属家庭的共享分类）
    if (dto.categoryId) {
      const familyIds = await this.prisma.getUserFamilyIds(userId);
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
      if (category.familyId && category.familyId !== (dto.familyId ?? null)) {
        throw new BadRequestException('分类不属于该账本');
      }
    }

    // 检查是否已存在相同周期和分类的预算
    const existing = await this.prisma.budget.findFirst({
      where: {
        userId,
        familyId: dto.familyId ?? null,
        period: dto.period,
        categoryId: dto.categoryId ?? null,
        isActive: true,
      },
    });

    if (existing) {
      throw new ConflictException('该周期已存在相同分类的预算');
    }

    return this.prisma.budget.create({
      data: {
        userId,
        familyId: dto.familyId,
        amount: new Decimal(dto.amount.toFixed(2)),
        period: dto.period,
        categoryId: dto.categoryId,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * 获取预算列表（分页）
   */
  async findAll(userId: string, familyId?: string, page = 1, pageSize = 50) {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);

    const where: any = { userId, familyId: familyId ?? null };

    if (familyId) {
      where.familyId = familyId;
    }

    const [items, total] = await Promise.all([
      this.prisma.budget.findMany({
        where,
        include: {
          category: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.budget.count({ where }),
    ]);

    return createPaginatedResponse(items, safePage, safePageSize, total);
  }

  /**
   * 获取预算详情
   */
  async findOne(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
      include: {
        category: true,
      },
    });

    if (!budget) {
      throw new NotFoundException('预算不存在');
    }

    return budget;
  }

  /**
   * 更新预算
   */
  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
    });

    if (!budget) {
      throw new NotFoundException('预算不存在');
    }

    // 更换家庭归属时验证成员身份
    if (dto.familyId && dto.familyId !== budget.familyId) {
      const member = await this.prisma.familyMember.findFirst({
        where: { familyId: dto.familyId, userId },
      });
      if (!member) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
    }

    // 更换分类时验证分类可用性
    const nextCategory = dto.categoryId !== undefined ? dto.categoryId : budget.categoryId;
    const nextFamily = dto.familyId !== undefined ? dto.familyId : budget.familyId;
    if (nextCategory && (dto.categoryId !== undefined || dto.familyId !== undefined)) {
      const familyIds = await this.prisma.getUserFamilyIds(userId);
      const category = await this.prisma.category.findFirst({
        where: {
          id: nextCategory,
          OR: [
            { userId },
            { familyId: { in: familyIds }, isFamilyShared: true },
          ],
        },
      });
      if (!category) {
        throw new NotFoundException('分类不存在');
      }
      if (category.familyId && category.familyId !== nextFamily) {
        throw new BadRequestException('分类不属于该账本');
      }
    }

    // 周期/分类/家庭归属变化时，检查是否与现有激活预算冲突
    // 注意：必须用 !== undefined 判断「是否提供」，因为 null 是合法值（清空分类/家庭）
    const periodChanged =
      dto.period !== undefined && dto.period !== budget.period;
    const categoryChanged =
      dto.categoryId !== undefined && dto.categoryId !== budget.categoryId;
    const familyChanged =
      dto.familyId !== undefined && dto.familyId !== budget.familyId;

    if ((dto.isActive ?? budget.isActive) &&
      (periodChanged || categoryChanged || familyChanged || dto.isActive === true)) {
      const nextFamilyId =
        dto.familyId !== undefined ? dto.familyId : budget.familyId;
      const nextPeriod = dto.period ?? budget.period;
      const nextCategoryId =
        dto.categoryId !== undefined ? dto.categoryId : budget.categoryId;

      const existing = await this.prisma.budget.findFirst({
        where: {
          userId,
          familyId: nextFamilyId ?? null,
          period: nextPeriod,
          categoryId: nextCategoryId ?? null,
          isActive: true,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('该周期已存在相同分类的预算');
      }
    }

    return this.prisma.budget.update({
      where: { id },
      data: {
        ...dto,
        amount:
          dto.amount !== undefined ? new Decimal(dto.amount.toFixed(2)) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate === null ? null : dto.endDate ? new Date(dto.endDate) : undefined,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * 删除预算（停用由 isActive 控制）
   */
  async remove(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
    });

    if (!budget) {
      throw new NotFoundException('预算不存在');
    }

    await this.prisma.budget.delete({ where: { id } });

    return { message: '删除成功' };
  }

  /**
   * 获取单个预算进度
   */
  async getProgress(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId, isActive: true },
      include: {
        category: true,
      },
    });

    if (!budget) {
      throw new NotFoundException('预算不存在或已失效');
    }

    if (budget.familyId && !(await this.prisma.getUserFamilyIds(userId)).includes(budget.familyId)) {
      throw new ForbiddenException('您不是该家庭的成员');
    }
    return this.computeProgress(userId, budget);
  }

  /**
   * 获取所有预算进度
   *
   * 按「(家庭归属, 周期范围)」分组做聚合查询，避免逐预算查询（消除 N+1）
   */
  async getAllProgress(userId: string, familyId?: string) {
    if (familyId && !(await this.prisma.getUserFamilyIds(userId)).includes(familyId)) {
      throw new ForbiddenException('您不是该家庭的成员');
    }
    const budgets = await this.prisma.budget.findMany({
      where: {
        userId,
        isActive: true,
        familyId: familyId ?? null,
      },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    if (budgets.length === 0) {
      return [];
    }

    // 分组缓存：key → 该组内按分类聚合的支出
    const groupCache = new Map<
      string,
      { startDate: Date; endDate: Date; categoryTotals: Map<string | null, number> }
    >();

    const getGroup = async (budget: Budget) => {
      const { startDate, endDate } = this.getPeriodRange(
        budget.period,
        budget.startDate,
        budget.endDate,
      );
      const key = `${budget.familyId ?? 'personal'}|${startDate.getTime()}|${endDate.getTime()}`;

      let group = groupCache.get(key);
      if (!group) {
        const where: any = {
          type: TransactionType.expense,
          deletedAt: null,
          date: { gte: startDate, lte: endDate },
        };
        if (budget.familyId) {
          // 家庭预算：统计所有家庭成员的共享支出
          where.familyId = budget.familyId;
          where.isFamilyShared = true;
        } else {
          where.userId = userId;
          where.familyId = null;
        }

        const rows = await this.prisma.transaction.groupBy({
          by: ['categoryId'],
          where,
          _sum: { amount: true },
        });

        const categoryTotals = new Map<string | null, number>();
        for (const row of rows) {
          categoryTotals.set(row.categoryId, Number(row._sum.amount ?? 0));
        }

        group = { startDate, endDate, categoryTotals };
        groupCache.set(key, group);
      }
      return group;
    };

    const progressList = [];
    for (const budget of budgets) {
      const group = await getGroup(budget);

      // 分类预算取该分类支出，总额预算取全部支出
      const spent = budget.categoryId
        ? (group.categoryTotals.get(budget.categoryId) ?? 0)
        : [...group.categoryTotals.values()].reduce((sum, v) => sum + v, 0);

      const amount = Number(budget.amount);
      const percentage = amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;

      progressList.push({
        budget: {
          id: budget.id,
          familyId: budget.familyId,
          amount,
          period: budget.period,
          category: budget.category,
          startDate: group.startDate,
          endDate: group.endDate,
        },
        spent: Number(spent.toFixed(2)),
        remaining: Number((amount - spent).toFixed(2)),
        percentage: Math.round(percentage * 100) / 100,
        isOverBudget: spent > amount,
      });
    }

    return progressList;
  }

  /**
   * 计算单个预算的进度
   */
  private async computeProgress(userId: string, budget: any) {
    const { startDate, endDate } = this.getPeriodRange(
      budget.period,
      budget.startDate,
      budget.endDate,
    );

    const where: any = {
      type: TransactionType.expense,
      deletedAt: null,
      date: { gte: startDate, lte: endDate },
    };
    if (budget.familyId) {
      // 家庭预算：统计所有家庭成员的共享支出
      where.familyId = budget.familyId;
      where.isFamilyShared = true;
    } else {
      where.userId = userId;
      where.familyId = null;
    }

    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
    });

    const spent = budget.categoryId
      ? Number(
        rows.find((row) => row.categoryId === budget.categoryId)?._sum.amount ??
        0,
      )
      : rows.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);

    const amount = Number(budget.amount);
    const percentage = amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;

    return {
      budget: {
        id: budget.id,
        familyId: budget.familyId,
        amount,
        period: budget.period,
        category: budget.category,
        startDate,
        endDate,
      },
      spent: Number(spent.toFixed(2)),
      remaining: Number((amount - spent).toFixed(2)),
      percentage: Math.round(percentage * 100) / 100,
      isOverBudget: spent > amount,
    };
  }

  /**
   * 获取周期日期范围：当前统计周期 ∩ 预算生效区间
   *
   * - monthly：当前自然月；yearly：当前自然年
   * - 与预算的 startDate/endDate 求交集（未来预算得到空区间，进度为 0）
   */
  private getPeriodRange(
    period: BudgetPeriod,
    startDate: Date,
    endDate?: Date | null,
  ) {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    if (period === BudgetPeriod.monthly) {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      periodStart = new Date(now.getFullYear(), 0, 1);
      periodEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }

    // 与预算自身生效区间求交集（预算 endDate 按「当天最后一毫秒」理解，包含当天）
    const start = startDate > periodStart ? startDate : periodStart;
    const budgetEnd = endDate ? endOfDay(new Date(endDate)) : null;
    const end = budgetEnd && budgetEnd < periodEnd ? budgetEnd : periodEnd;

    return { startDate: start, endDate: end };
  }
}
