import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { JoinFamilyDto } from './dto/join-family.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { FamilyRole, TransactionType } from '@prisma/client';
import {
  assertValidDateRange,
  createPaginatedResponse,
  endOfDay,
  generateInviteCode,
} from '../../common/utils';

/** 分类统计条目 */
export interface CategoryStat {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  income: number;
  expense: number;
}

@Injectable()
export class FamiliesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * 创建家庭
   */
  async create(userId: string, dto: CreateFamilyDto) {
    const expiresDays = this.configService.get<number>(
      'INVITE_CODE_EXPIRES_DAYS',
      7,
    );
    const inviteCodeExpiresAt = new Date();
    inviteCodeExpiresAt.setDate(inviteCodeExpiresAt.getDate() + expiresDays);

    // 邀请码唯一冲突时重试（最多 5 次），避免 P2002 直接 500
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = generateInviteCode(
        this.configService.get<number>('INVITE_CODE_LENGTH', 6),
      );

      try {
        const family = await this.prisma.family.create({
          data: {
            name: dto.name,
            description: dto.description,
            createdBy: userId,
            inviteCode,
            inviteCodeExpiresAt,
          },
        });

        // 创建者为 owner
        await this.prisma.familyMember.create({
          data: {
            familyId: family.id,
            userId,
            role: FamilyRole.owner,
          },
        });

        return {
          ...family,
          inviteCode, // 返回邀请码
        };
      } catch (error: any) {
        // 邀请码撞库 → 重新生成再试
        if (error?.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('邀请码生成失败，请重试');
  }

  /**
   * 获取用户的家庭列表
   */
  async findAll(userId: string) {
    const members = await this.prisma.familyMember.findMany({
      where: { userId },
      include: {
        family: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return members.map((member) => ({
      ...member.family,
      myRole: member.role,
      memberCount: member.family.members.length,
    }));
  }

  /**
   * 获取家庭详情
   */
  async findOne(userId: string, id: string) {
    const family = await this.prisma.family.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        creator: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    if (!family) {
      throw new NotFoundException('家庭不存在');
    }

    // 检查用户是否是家庭成员
    const member = family.members.find((m) => m.userId === userId);
    if (!member) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    return {
      ...family,
      myRole: member.role,
    };
  }

  /**
   * 更新家庭信息
   */
  async update(userId: string, id: string, dto: UpdateFamilyDto) {
    // 先确认家庭存在，避免 Prisma P2025 变 500
    const family = await this.prisma.family.findUnique({
      where: { id },
    });
    if (!family) {
      throw new NotFoundException('家庭不存在');
    }

    // 检查权限
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId: id, userId },
    });

    if (!member || (member.role !== FamilyRole.owner && member.role !== FamilyRole.admin)) {
      throw new ForbiddenException('没有权限修改家庭信息');
    }

    return this.prisma.family.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * 解散家庭
   */
  async remove(userId: string, id: string) {
    // 只有创建者可以解散
    const family = await this.prisma.family.findUnique({
      where: { id },
    });

    if (!family) {
      throw new NotFoundException('家庭不存在');
    }

    if (family.createdBy !== userId) {
      throw new ForbiddenException('只有创建者可以解散家庭');
    }

    await this.prisma.family.delete({ where: { id } });

    return { message: '家庭已解散' };
  }

  /**
   * 加入家庭
   */
  async join(userId: string, dto: JoinFamilyDto) {
    // 查找家庭
    const family = await this.prisma.family.findUnique({
      where: { inviteCode: dto.inviteCode },
    });

    if (!family) {
      throw new NotFoundException('邀请码无效');
    }

    // 检查邀请码是否过期
    if (family.inviteCodeExpiresAt && family.inviteCodeExpiresAt < new Date()) {
      throw new BadRequestException('邀请码已过期');
    }

    // 检查是否已是成员
    const existingMember = await this.prisma.familyMember.findFirst({
      where: { familyId: family.id, userId },
    });

    if (existingMember) {
      throw new ConflictException('您已经是该家庭的成员');
    }

    // 加入家庭
    const member = await this.prisma.familyMember.create({
      data: {
        familyId: family.id,
        userId,
        role: FamilyRole.member,
      },
      include: {
        family: true,
      },
    });

    return member;
  }

  /**
   * 退出家庭
   */
  async leave(userId: string, id: string) {
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId: id, userId },
    });

    if (!member) {
      throw new NotFoundException('您不是该家庭的成员');
    }

    // 检查是否是创建者
    const family = await this.prisma.family.findUnique({
      where: { id },
    });

    if (family?.createdBy === userId) {
      throw new BadRequestException('创建者不能退出家庭，请先解散家庭或转让权限');
    }

    await this.prisma.familyMember.delete({
      where: { id: member.id },
    });

    return { message: '已退出家庭' };
  }

  /**
   * 生成新邀请码
   */
  async refreshInviteCode(userId: string, id: string) {
    // 检查权限
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId: id, userId },
    });

    if (!member || (member.role !== FamilyRole.owner && member.role !== FamilyRole.admin)) {
      throw new ForbiddenException('没有权限生成邀请码');
    }

    const expiresDays = this.configService.get<number>('INVITE_CODE_EXPIRES_DAYS', 7);
    const inviteCodeExpiresAt = new Date();
    inviteCodeExpiresAt.setDate(inviteCodeExpiresAt.getDate() + expiresDays);

    // 邀请码唯一冲突时重试（最多 5 次）
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = generateInviteCode(
        this.configService.get<number>('INVITE_CODE_LENGTH', 6),
      );

      try {
        const family = await this.prisma.family.update({
          where: { id },
          data: { inviteCode, inviteCodeExpiresAt },
        });

        return {
          inviteCode: family.inviteCode,
          expiresAt: family.inviteCodeExpiresAt,
        };
      } catch (error: any) {
        if (error?.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('邀请码生成失败，请重试');
  }

  /**
   * 移除成员
   */
  async removeMember(userId: string, familyId: string, memberId: string) {
    // 检查权限
    const operator = await this.prisma.familyMember.findFirst({
      where: { familyId, userId },
    });

    if (!operator || (operator.role !== FamilyRole.owner && operator.role !== FamilyRole.admin)) {
      throw new ForbiddenException('没有权限移除成员');
    }

    const member = await this.prisma.familyMember.findFirst({
      where: { id: memberId, familyId },
    });

    if (!member) {
      throw new NotFoundException('成员不存在');
    }

    // 不能移除 owner
    if (member.role === FamilyRole.owner) {
      throw new ForbiddenException('不能移除创建者');
    }

    // admin 不能移除 admin
    if (operator.role === FamilyRole.admin && member.role === FamilyRole.admin) {
      throw new ForbiddenException('没有权限移除管理员');
    }

    await this.prisma.familyMember.delete({
      where: { id: memberId },
    });

    return { message: '成员已移除' };
  }

  /**
   * 更新成员角色
   */
  async updateMemberRole(
    userId: string,
    familyId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ) {
    // owner 角色由创建家庭产生，不允许通过接口指派（防止出现多个 owner）
    if (dto.role === FamilyRole.owner) {
      throw new BadRequestException('不能将成员设置为创建者角色');
    }

    // 只有 owner 可以修改角色
    const operator = await this.prisma.familyMember.findFirst({
      where: { familyId, userId, role: FamilyRole.owner },
    });

    if (!operator) {
      throw new ForbiddenException('只有创建者可以修改成员角色');
    }

    const member = await this.prisma.familyMember.findFirst({
      where: { id: memberId, familyId },
    });

    if (!member) {
      throw new NotFoundException('成员不存在');
    }

    // 不能修改自己的角色（防止家庭失去 owner）
    if (member.userId === userId) {
      throw new BadRequestException('不能修改自己的角色');
    }

    return this.prisma.familyMember.update({
      where: { id: memberId },
      data: { role: dto.role },
    });
  }

  /**
   * 获取家庭账单（分页）
   */
  async getTransactions(
    userId: string,
    familyId: string,
    startDate?: string,
    endDate?: string,
    memberId?: string,
    page = 1,
    pageSize = 50,
  ) {
    // 验证成员身份
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId, userId },
    });

    if (!member) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    const where: any = {
      familyId,
      isFamilyShared: true,
      deletedAt: null,
    };

    if (startDate || endDate) {
      assertValidDateRange(startDate, endDate);
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = endOfDay(endDate);
    }

    if (memberId) {
      where.userId = memberId;
    }

    // 分页参数收敛到安全范围
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);

    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
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
        orderBy: { date: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
    ]);

    return createPaginatedResponse(transactions, safePage, safePageSize, total);
  }

  /**
   * 获取家庭统计
   */
  async getSummary(userId: string, familyId: string, startDate?: string, endDate?: string) {
    // 验证成员身份
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId, userId },
    });

    if (!member) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    const where: any = {
      familyId,
      isFamilyShared: true,
      deletedAt: null,
    };

    if (startDate || endDate) {
      assertValidDateRange(startDate, endDate);
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = endOfDay(endDate);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        userId: true,
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;
    const memberStats: Record<string, { income: number; expense: number }> = {};

    for (const t of transactions) {
      const amount = Number(t.amount);
      
      if (!memberStats[t.userId]) {
        memberStats[t.userId] = { income: 0, expense: 0 };
      }

      if (t.type === TransactionType.income) {
        totalIncome += amount;
        memberStats[t.userId].income += amount;
      } else {
        totalExpense += amount;
        memberStats[t.userId].expense += amount;
      }
    }

    // 统一两位小数，消除浮点累加误差
    for (const stat of Object.values(memberStats)) {
      stat.income = Number(stat.income.toFixed(2));
      stat.expense = Number(stat.expense.toFixed(2));
    }

    return {
      totalIncome: Number(totalIncome.toFixed(2)),
      totalExpense: Number(totalExpense.toFixed(2)),
      balance: Number((totalIncome - totalExpense).toFixed(2)),
      transactionCount: transactions.length,
      memberStats,
    };
  }

  /**
   * 获取家庭统计分析：分类占比、月度趋势、成员收支
   */
  async getStatistics(
    userId: string,
    familyId: string,
    startDate?: string,
    endDate?: string,
  ) {
    // 验证成员身份
    const member = await this.prisma.familyMember.findFirst({
      where: { familyId, userId },
    });

    if (!member) {
      throw new ForbiddenException('您不是该家庭的成员');
    }

    const where: any = {
      familyId,
      isFamilyShared: true,
      deletedAt: null,
    };

    if (startDate || endDate) {
      assertValidDateRange(startDate, endDate);
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = endOfDay(endDate);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        date: true,
        userId: true,
        category: {
          select: {
            id: true,
            name: true,
            icon: true,
            color: true,
          },
        },
      },
    });

    const categoryMap = new Map<string, CategoryStat>();
    const memberMap = new Map<string, { income: number; expense: number }>();
    const monthMap = new Map<
      string,
      { month: string; income: number; expense: number }
    >();

    let totalIncome = 0;
    let totalExpense = 0;

    for (const t of transactions) {
      const amount = Number(t.amount);
      const isIncome = t.type === TransactionType.income;

      if (isIncome) {
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }

      // 分类汇总
      let categoryStat = categoryMap.get(t.category.id);
      if (!categoryStat) {
        categoryStat = {
          categoryId: t.category.id,
          name: t.category.name,
          icon: t.category.icon,
          color: t.category.color,
          income: 0,
          expense: 0,
        };
        categoryMap.set(t.category.id, categoryStat);
      }
      if (isIncome) {
        categoryStat.income += amount;
      } else {
        categoryStat.expense += amount;
      }

      // 成员汇总
      let memberStat = memberMap.get(t.userId);
      if (!memberStat) {
        memberStat = { income: 0, expense: 0 };
        memberMap.set(t.userId, memberStat);
      }
      if (isIncome) {
        memberStat.income += amount;
      } else {
        memberStat.expense += amount;
      }

      // 月度趋势（按 YYYY-MM 聚合）
      const month = t.date.toISOString().slice(0, 7);
      let monthStat = monthMap.get(month);
      if (!monthStat) {
        monthStat = { month, income: 0, expense: 0 };
        monthMap.set(month, monthStat);
      }
      if (isIncome) {
        monthStat.income += amount;
      } else {
        monthStat.expense += amount;
      }
    }

    // 统一两位小数，消除浮点累加误差
    const round = (value: number) => Number(value.toFixed(2));
    for (const stat of [
      ...categoryMap.values(),
      ...memberMap.values(),
      ...monthMap.values(),
    ]) {
      stat.income = round(stat.income);
      stat.expense = round(stat.expense);
    }

    return {
      totalIncome: round(totalIncome),
      totalExpense: round(totalExpense),
      balance: round(totalIncome - totalExpense),
      transactionCount: transactions.length,
      // 按总金额降序排列
      categoryBreakdown: [...categoryMap.values()].sort(
        (a, b) => b.income + b.expense - (a.income + a.expense),
      ),
      // 按月份升序排列
      monthlyTrend: [...monthMap.values()].sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
      memberStats: Object.fromEntries(memberMap),
    };
  }
}
