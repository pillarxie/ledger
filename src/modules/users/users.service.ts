import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * 根据ID获取用户
   */
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  /**
   * 根据邮箱获取用户
   */
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * 根据用户名获取用户
   */
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  /**
   * 更新用户信息
   */
  async update(id: string, dto: UpdateUserDto) {
    // 检查用户名是否被使用
    if (dto.username) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: dto.username,
          NOT: { id },
        },
      });

      if (existingUser) {
        throw new ConflictException('用户名已被使用');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  /**
   * 更新用户头像
   */
  async updateAvatar(id: string, avatarUrl: string) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { avatar: avatarUrl },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  /**
   * 删除用户（注销账号）
   */
  async delete(id: string) {
    // 删除用户创建的家庭（级联删除其成员；账单/分类/预算的 familyId 置空）
    await this.prisma.family.deleteMany({ where: { createdBy: id } });

    // 删除用户的所有关联数据
    // 顺序很重要：先删引用方（账单），再删被引用方（分类/账户），满足外键约束
    await this.prisma.$transaction([
      // 删除账单（引用分类/账户/用户）
      this.prisma.transaction.deleteMany({ where: { userId: id } }),
      // 删除分类
      this.prisma.category.deleteMany({ where: { userId: id } }),
      // 删除账户
      this.prisma.account.deleteMany({ where: { userId: id } }),
      // 删除预算
      this.prisma.budget.deleteMany({ where: { userId: id } }),
      // 删除在其他家庭的成员记录（自己家庭已随家庭删除级联清理）
      this.prisma.familyMember.deleteMany({ where: { userId: id } }),
      // 删除同步日志
      this.prisma.syncLog.deleteMany({ where: { userId: id } }),
      // 删除用户
      this.prisma.user.delete({ where: { id } }),
    ]);

    return { message: '账号已注销' };
  }

  /**
   * 获取用户统计信息
   */
  async getStats(id: string) {
    const [
      transactionCount,
      accountCount,
      categoryCount,
      familyCount,
    ] = await Promise.all([
      this.prisma.transaction.count({ where: { userId: id } }),
      this.prisma.account.count({ where: { userId: id } }),
      this.prisma.category.count({ where: { userId: id } }),
      this.prisma.familyMember.count({ where: { userId: id } }),
    ]);

    return {
      transactionCount,
      accountCount,
      categoryCount,
      familyCount,
    };
  }
}
