import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 查询用户所属家庭的 ID 列表
   *
   * 用于把「家庭共享数据」限定在该用户所属家庭范围内，
   * 防止跨家庭数据泄露（账单/分类/同步等模块共用）
   */
  async getUserFamilyIds(userId: string): Promise<string[]> {
    const members = await this.familyMember.findMany({
      where: { userId },
      select: { familyId: true },
    });
    return members.map((member) => member.familyId);
  }
}
