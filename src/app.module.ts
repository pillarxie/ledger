import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { FamiliesModule } from './modules/families/families.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    
    // 基础设施模块
    PrismaModule,
    RedisModule,
    
    // 业务模块
    AuthModule,
    UsersModule,
    TransactionsModule,
    CategoriesModule,
    AccountsModule,
    FamiliesModule,
    BudgetsModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
