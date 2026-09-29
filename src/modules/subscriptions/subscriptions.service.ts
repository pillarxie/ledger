import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { chargeDate, currentInstallment, shanghaiDate } from './subscription-schedule';

@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.processDue();
    this.timer = setInterval(() => void this.processDue(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async create(userId: string, dto: CreateSubscriptionDto) {
    const parsed = new Date(`${dto.firstChargeDate}T00:00:00Z`);
    if (!dto.name.trim() || !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== dto.firstChargeDate ||
        dto.firstChargeDate < '1900-01-01' || dto.firstChargeDate > '9990-01-01') {
      throw new BadRequestException('请输入有效的续费名称和首次扣费日期');
    }
    const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('扣费账户不存在');
    const today = shanghaiDate();
    const current = currentInstallment(dto, today);
    const processedInstallments = chargeDate(dto, current) < today ? current : current - 1;
    const subscription = await this.prisma.subscription.create({
      data: { ...dto, name: dto.name.trim(), userId, processedInstallments },
    });
    await this.tryProcess(subscription.id, today);
    return this.get(userId, subscription.id);
  }

  async list(userId: string) {
    const subscriptions = await this.prisma.subscription.findMany({ where: { userId }, select: { id: true } });
    const today = shanghaiDate();
    for (const subscription of subscriptions) await this.tryProcess(subscription.id, today);
    const rows = await this.prisma.subscription.findMany({
      where: { userId }, include: { account: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(row => this.serialize(row));
  }

  async stop(userId: string, id: string) {
    const subscription = await this.prisma.subscription.findFirst({ where: { id, userId } });
    if (!subscription) throw new NotFoundException('续费项目不存在');
    const now = new Date();
    const today = shanghaiDate(now);
    // Only the first stop sets the cutoff. A repeated request cannot extend it.
    await this.prisma.subscription.updateMany({
      where: { id, userId, status: 'active' },
      data: { status: 'stopped', stoppedAt: now,
        lastChargeDate: chargeDate(subscription, currentInstallment(subscription, today)) },
    });
    await this.tryProcess(id, today);
    return this.get(userId, id);
  }

  private async get(userId: string, id: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, userId }, include: { account: { select: { id: true, name: true } } },
    });
    if (!subscription) throw new NotFoundException('续费项目不存在');
    return this.serialize(subscription);
  }

  private serialize(subscription: Subscription & { account?: { id: string; name: string } }) {
    const next = chargeDate(subscription, subscription.processedInstallments + 1);
    return { ...subscription, amount: Number(subscription.amount),
      nextChargeDate: subscription.lastChargeDate && next > subscription.lastChargeDate ? null : next };
  }

  private async tryProcess(id: string, today: string) {
    try { await this.processSubscription(id, today); }
    catch (error) { this.logger.error(`续费项目 ${id} 记账失败，将自动重试`, error); }
  }

  async processDue() {
    if (this.running) return;
    this.running = true;
    try {
      // Stopped subscriptions may still have an unprocessed charge from their final period.
      const subscriptions = await this.prisma.subscription.findMany({ select: { id: true } });
      const today = shanghaiDate();
      for (const subscription of subscriptions) await this.tryProcess(subscription.id, today);
    } catch (error) {
      this.logger.error('续费检查失败，将自动重试', error);
    } finally { this.running = false; }
  }

  async processSubscription(id: string, today: string) {
    await this.prisma.$transaction(async tx => {
      const subscription = await tx.subscription.findUnique({ where: { id } });
      if (!subscription) return;
      const cutoff = subscription.lastChargeDate && subscription.lastChargeDate < today
        ? subscription.lastChargeDate : today;
      const current = currentInstallment(subscription, cutoff);
      const next = chargeDate(subscription, current) <= cutoff ? current : current - 1;
      if (next <= subscription.processedInstallments) return;
      // Lock the row by claiming its previous progress and stop state. Concurrent stop
      // or processing invalidates this claim; transactions and balance changes roll back together.
      const claimed = await tx.subscription.updateMany({
        where: { id, processedInstallments: subscription.processedInstallments,
          status: subscription.status, lastChargeDate: subscription.lastChargeDate },
        data: { processedInstallments: next },
      });
      if (!claimed.count) return;
      const categoryId = `subscription-${subscription.userId}`;
      await tx.category.upsert({
        where: { id: categoryId },
        update: { type: 'expense', familyId: null, isFamilyShared: false },
        create: { id: categoryId, userId: subscription.userId, name: '自动续费', type: 'expense',
          icon: 'autorenew', color: '#607D8B', isDefault: true },
      });
      for (let index = subscription.processedInstallments; index < next; index++) {
        await tx.transaction.create({ data: {
          userId: subscription.userId, type: 'expense', amount: subscription.amount, categoryId,
          accountId: subscription.accountId,
          date: new Date(`${chargeDate(subscription, index + 1)}T00:00:00.000Z`),
          note: `自动续费-${subscription.name}`, tags: [],
          subscriptionId: id, subscriptionInstallment: index + 1,
        } });
        await tx.account.update({ where: { id: subscription.accountId },
          data: { balance: { decrement: subscription.amount } } });
      }
    }, { timeout: 30_000 });
  }
}
