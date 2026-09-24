/**
 * 种子数据：创建演示账号与默认收支分类
 *
 * 运行方式：
 *   pnpm prisma:seed           （或 npx prisma db seed）
 */
import { PrismaClient, TransactionType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 未配置，无法初始化种子数据');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const DEFAULT_CATEGORIES: Array<{
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
}> = [
  // 支出分类
  { name: '餐饮', type: TransactionType.expense, icon: 'food', color: '#FF7043' },
  { name: '交通', type: TransactionType.expense, icon: 'transport', color: '#42A5F5' },
  { name: '购物', type: TransactionType.expense, icon: 'shopping', color: '#EC407A' },
  { name: '娱乐', type: TransactionType.expense, icon: 'entertainment', color: '#AB47BC' },
  { name: '居住', type: TransactionType.expense, icon: 'home', color: '#8D6E63' },
  { name: '医疗', type: TransactionType.expense, icon: 'medical', color: '#EF5350' },
  { name: '教育', type: TransactionType.expense, icon: 'education', color: '#5C6BC0' },
  { name: '其他支出', type: TransactionType.expense, icon: 'other', color: '#78909C' },
  // 收入分类
  { name: '工资', type: TransactionType.income, icon: 'salary', color: '#66BB6A' },
  { name: '奖金', type: TransactionType.income, icon: 'bonus', color: '#26A69A' },
  { name: '理财', type: TransactionType.income, icon: 'investment', color: '#FFA726' },
  { name: '其他收入', type: TransactionType.income, icon: 'other', color: '#9CCC65' },
];

async function main() {
  console.log('🌱 开始初始化种子数据...');

  // 演示账号（已存在则跳过）
  const password = await bcrypt.hash('Password123!', 10);
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@ledger.app' },
    update: {},
    create: {
      username: 'demo',
      email: 'demo@ledger.app',
      password,
    },
  });

  // 为演示账号创建默认分类
  let created = 0;
  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    const existing = await prisma.category.findFirst({
      where: {
        userId: demoUser.id,
        name: category.name,
        type: category.type,
      },
    });
    if (existing) {
      continue;
    }

    await prisma.category.create({
      data: {
        userId: demoUser.id,
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        sortOrder: index,
        isDefault: true,
      },
    });
    created++;
  }

  console.log(`✅ 演示账号：demo@ledger.app / Password123!`);
  console.log(`✅ 默认分类：新增 ${created} 个（共 ${DEFAULT_CATEGORIES.length} 个）`);
}

main()
  .catch((error) => {
    console.error('❌ 种子数据初始化失败:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
