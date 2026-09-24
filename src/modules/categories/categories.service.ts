import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoryDto } from './dto/reorder-category.dto';
import { TransactionType } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建分类
   */
  async create(userId: string, dto: CreateCategoryDto) {
    // 如果关联家庭，验证用户是否是家庭成员
    if (dto.familyId) {
      const member = await this.prisma.familyMember.findFirst({
        where: { familyId: dto.familyId, userId },
      });
      if (!member) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
    }

    // 检查同范围内分类名称是否重复（个人范围按用户查，共享范围按家庭跨成员查）
    await this.assertCategoryNameAvailable(
      userId,
      dto.familyId ?? null,
      dto.name,
      dto.type,
    );

    return this.prisma.category.create({
      data: {
        userId,
        familyId: dto.familyId,
        name: dto.name,
        type: dto.type,
        icon: dto.icon,
        color: dto.color,
        sortOrder: dto.sortOrder ?? 0,
        isFamilyShared: dto.isFamilyShared ?? false,
      },
    });
  }

  /**
   * 获取分类列表（本人分类 + 所属家庭的共享分类）
   */
  async findAll(userId: string, type?: TransactionType, familyId?: string) {
    // 用户所属家庭范围（防止跨家庭共享分类泄露）
    const familyIds = await this.prisma.getUserFamilyIds(userId);

    const where: any = {
      OR: [
        { userId, familyId: null },
        { familyId: { in: familyIds }, isFamilyShared: true },
      ],
    };

    if (type) {
      where.type = type;
    }

    if (familyId) {
      // 指定家庭时必须验证成员身份
      if (!familyIds.includes(familyId)) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
      where.OR = [
        { userId, familyId },
        { familyId, isFamilyShared: true },
      ];
    }

    return this.prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 获取分类详情
   */
  async findOne(userId: string, id: string) {
    // 用户所属家庭范围（防止跨家庭共享分类泄露）
    const familyIds = await this.prisma.getUserFamilyIds(userId);

    const category = await this.prisma.category.findFirst({
      where: {
        id,
        OR: [
          { userId },
          { familyId: { in: familyIds }, isFamilyShared: true },
        ],
      },
    });

    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    return category;
  }

  /**
   * 更新分类
   */
  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findFirst({
      where: { id, userId },
    });

    if (!category) {
      throw new NotFoundException('分类不存在或无权修改');
    }

    // 更换家庭归属时验证成员身份
    if (dto.familyId && dto.familyId !== category.familyId) {
      const member = await this.prisma.familyMember.findFirst({
        where: { familyId: dto.familyId, userId },
      });
      if (!member) {
        throw new ForbiddenException('您不是该家庭的成员');
      }
    }

    // 名称/类型/归属范围变化时，检查同范围内是否重复
    const nextName = dto.name ?? category.name;
    const nextType = dto.type ?? category.type;
    const nextFamilyId =
      dto.familyId !== undefined ? dto.familyId : category.familyId;

    if (
      dto.name !== undefined ||
      dto.type !== undefined ||
      dto.familyId !== undefined
    ) {
      await this.assertCategoryNameAvailable(
        userId,
        nextFamilyId ?? null,
        nextName,
        nextType,
        category.id,
      );
    }

    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * 删除分类
   */
  async remove(userId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, userId },
    });

    if (!category) {
      throw new NotFoundException('分类不存在或无权删除');
    }

    // 检查是否有关联账单（软删除的不计入）
    const transactionCount = await this.prisma.transaction.count({
      where: { categoryId: id, deletedAt: null },
    });

    if (transactionCount > 0) {
      throw new ConflictException('该分类下有账单，无法删除');
    }

    await this.prisma.category.delete({ where: { id } });

    return { message: '删除成功' };
  }

  /**
   * 排序分类
   */
  async reorder(userId: string, dto: ReorderCategoryDto) {
    // 校验所有 ID 都属于当前用户，避免部分成功、静默忽略非本人 ID
    const ids = dto.orders.map((item) => item.id);
    const ownedCount = await this.prisma.category.count({
      where: { id: { in: ids }, userId },
    });

    if (ownedCount !== new Set(ids).size) {
      throw new NotFoundException('存在不存在或无权排序的分类');
    }

    // 拒绝重复的排序值（会导致顺序不确定）
    const sortOrders = dto.orders.map((item) => item.sortOrder);
    if (new Set(sortOrders).size !== sortOrders.length) {
      throw new ConflictException('排序值不能重复');
    }

    const updates = dto.orders.map((item) =>
      this.prisma.category.updateMany({
        where: { id: item.id, userId },
        data: { sortOrder: item.sortOrder },
      }),
    );

    await Promise.all(updates);

    return { message: '排序成功' };
  }

  /**
   * 校验分类名称在同范围内唯一
   *
   * - 个人范围（familyId=null）：同一用户下不重名
   * - 家庭共享范围（familyId 非空）：同一家庭内跨成员不重名
   */
  private async assertCategoryNameAvailable(
    userId: string,
    familyId: string | null,
    name: string,
    type: TransactionType,
    excludeId?: string,
  ) {
    const baseWhere = {
      name,
      type,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    };

    if (familyId) {
      const sharedDuplicate = await this.prisma.category.findFirst({
        where: { familyId, isFamilyShared: true, ...baseWhere },
      });
      if (sharedDuplicate) {
        throw new ConflictException('该家庭中已存在同名分类');
      }
    }

    const personalDuplicate = await this.prisma.category.findFirst({
      where: { userId, familyId: null, ...baseWhere },
    });
    if (personalDuplicate) {
      throw new ConflictException('分类名称已存在');
    }
  }

  /**
   * 初始化默认分类
   */
  async initDefaultCategories(userId: string) {
    const defaultCategories = [
      // 支出分类
      { name: '餐饮', type: TransactionType.expense, icon: 'restaurant', color: '#FF6B6B' },
      { name: '交通', type: TransactionType.expense, icon: 'directions_car', color: '#4ECDC4' },
      { name: '购物', type: TransactionType.expense, icon: 'shopping_cart', color: '#45B7D1' },
      { name: '娱乐', type: TransactionType.expense, icon: 'sports_esports', color: '#96CEB4' },
      { name: '医疗', type: TransactionType.expense, icon: 'local_hospital', color: '#FFEAA7' },
      { name: '教育', type: TransactionType.expense, icon: 'school', color: '#DDA0DD' },
      { name: '居住', type: TransactionType.expense, icon: 'home', color: '#98D8C8' },
      { name: '通讯', type: TransactionType.expense, icon: 'phone', color: '#F7DC6F' },
      { name: '服饰', type: TransactionType.expense, icon: 'checkroom', color: '#BB8FCE' },
      { name: '其他支出', type: TransactionType.expense, icon: 'more_horiz', color: '#85C1E9' },
      // 收入分类
      { name: '工资', type: TransactionType.income, icon: 'account_balance_wallet', color: '#00D09C' },
      { name: '奖金', type: TransactionType.income, icon: 'card_giftcard', color: '#FF9F43' },
      { name: '投资', type: TransactionType.income, icon: 'trending_up', color: '#26DE81' },
      { name: '兼职', type: TransactionType.income, icon: 'work', color: '#A3CB38' },
      { name: '其他收入', type: TransactionType.income, icon: 'more_horiz', color: '#786FA6' },
    ];

    // 已存在的同名同类型分类跳过，支持重复调用（幂等）
    const existing = await this.prisma.category.findMany({
      where: { userId, familyId: null },
      select: { name: true, type: true },
    });
    const existingKeys = new Set(
      existing.map((category) => `${category.type}:${category.name}`),
    );

    const toCreate = defaultCategories.filter(
      (cat) => !existingKeys.has(`${cat.type}:${cat.name}`),
    );

    const created = await this.prisma.$transaction(
      toCreate.map((cat, index) =>
        this.prisma.category.create({
          data: {
            userId,
            name: cat.name,
            type: cat.type,
            icon: cat.icon,
            color: cat.color,
            sortOrder: index,
            isDefault: true,
          },
        }),
      ),
    );

    return created;
  }
}
