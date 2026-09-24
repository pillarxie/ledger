import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { TransferDto } from './dto/transfer.dto';
import { AccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建账户
   */
  async create(userId: string, dto: CreateAccountDto) {
    // 检查账户名称是否重复
    const existing = await this.prisma.account.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('账户名称已存在');
    }

    return this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        balance: new Decimal((dto.balance ?? 0).toFixed(2)),
        icon: dto.icon,
        color: dto.color,
        note: dto.note,
        sortOrder: dto.sortOrder ?? 0,
        isIncludedInTotal: dto.isIncludedInTotal ?? true,
      },
    });
  }

  /**
   * 获取账户列表（账户数量有限，不做分页；总余额需要全量统计）
   */
  async findAll(userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // 计算总余额
    const totalBalance = accounts.reduce((sum, account) => {
      if (account.isIncludedInTotal) {
        return sum + Number(account.balance);
      }
      return sum;
    }, 0);

    return {
      accounts,
      totalBalance: Number(totalBalance.toFixed(2)),
    };
  }

  /**
   * 获取账户详情
   */
  async findOne(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('账户不存在');
    }

    return account;
  }

  /**
   * 更新账户
   */
  async update(userId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('账户不存在');
    }

    // 检查名称是否重复
    if (dto.name && dto.name !== account.name) {
      const existing = await this.prisma.account.findFirst({
        where: { userId, name: dto.name, NOT: { id } },
      });

      if (existing) {
        throw new ConflictException('账户名称已存在');
      }
    }

    return this.prisma.account.update({
      where: { id },
      data: {
        ...dto,
        balance:
          dto.balance !== undefined
            ? new Decimal(dto.balance.toFixed(2))
            : undefined,
      },
    });
  }

  /**
   * 删除账户
   */
  async remove(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('账户不存在');
    }

    // 检查是否有关联账单（软删除的不计入）
    const transactionCount = await this.prisma.transaction.count({
      where: { accountId: id, deletedAt: null },
    });

    if (transactionCount > 0) {
      throw new ConflictException('该账户下有账单，无法删除');
    }

    await this.prisma.account.delete({ where: { id } });

    return { message: '删除成功' };
  }

  /**
   * 账户转账（原子扣减 + 余额不足保护）
   */
  async transfer(userId: string, dto: TransferDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('源账户和目标账户不能相同');
    }

    // 验证两个账户归属
    const [fromAccount, toAccount] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: dto.fromAccountId, userId },
      }),
      this.prisma.account.findFirst({
        where: { id: dto.toAccountId, userId },
      }),
    ]);

    if (!fromAccount) {
      throw new NotFoundException('源账户不存在');
    }
    if (!toAccount) {
      throw new NotFoundException('目标账户不存在');
    }

    const amount = new Decimal(dto.amount.toFixed(2));

    await this.prisma.$transaction(async (tx) => {
      // 原子扣减：余额不足时影响行数为 0（并发安全，不会透支）
      const result = await tx.account.updateMany({
        where: {
          id: dto.fromAccountId,
          userId,
          balance: { gte: amount },
        },
        data: { balance: { decrement: amount } },
      });

      if (result.count === 0) {
        throw new BadRequestException('源账户余额不足');
      }

      await tx.account.update({
        where: { id: dto.toAccountId },
        data: { balance: { increment: amount } },
      });
    });

    return { message: '转账成功' };
  }

  /**
   * 获取账户统计
   */
  async getStats(userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        type: true,
        balance: true,
        isIncludedInTotal: true,
      },
    });

    const stats = {
      totalAccounts: accounts.length,
      totalBalance: 0,
      byType: {} as Record<AccountType, { count: number; balance: number }>,
    };

    for (const account of accounts) {
      const balance = Number(account.balance);
      const type = account.type as AccountType;

      if (account.isIncludedInTotal) {
        stats.totalBalance += balance;
      }

      if (!stats.byType[type]) {
        stats.byType[type] = { count: 0, balance: 0 };
      }
      stats.byType[type].count++;
      stats.byType[type].balance += balance;
    }

    // 统一两位小数，避免浮点误差
    stats.totalBalance = Number(stats.totalBalance.toFixed(2));
    for (const entry of Object.values(stats.byType)) {
      entry.balance = Number(entry.balance.toFixed(2));
    }

    return stats;
  }
}
