import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Loan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { dueDate, paymentSchedule, shanghaiDate } from './loan-schedule';

@Injectable()
export class LoansService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoansService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.processDue();
    this.timer = setInterval(() => void this.processDue(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async create(userId: string, dto: CreateLoanDto) {
    const parsed = new Date(`${dto.startDate}T00:00:00Z`);
    if (!dto.name.trim() || !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== dto.startDate ||
        dto.startDate < '1900-01-01' || dto.startDate > '9990-01-01') {
      throw new BadRequestException('请输入有效的贷款名称和开始日期');
    }
    const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('还款账户不存在');
    const today = shanghaiDate();
    let processedInstallments = 0;
    while (processedInstallments < dto.years * 12 &&
        dueDate(dto, processedInstallments + 1) < today) processedInstallments++;
    const loan = await this.prisma.loan.create({
      data: { ...dto, name: dto.name.trim(), userId, processedInstallments,
        status: processedInstallments === dto.years * 12 ? 'completed' : 'active' },
    });
    try { await this.processLoan(loan.id, today); }
    catch (error) { this.logger.error(`贷款 ${loan.id} 已保存，记账将在后台重试`, error); }
    return this.get(userId, loan.id);
  }

  async list(userId: string) {
    const active = await this.prisma.loan.findMany({ where: { userId, status: 'active' } });
    for (const loan of active) {
      try { await this.processLoan(loan.id, shanghaiDate()); }
      catch (error) { this.logger.error(`贷款 ${loan.id} 记账失败，将自动重试`, error); }
    }
    const loans = await this.prisma.loan.findMany({
      where: { userId }, include: { account: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return loans.map(loan => this.serialize(loan));
  }

  async stop(userId: string, id: string) {
    const loan = await this.prisma.loan.findFirst({ where: { id, userId } });
    if (!loan) throw new NotFoundException('贷款不存在');
    await this.prisma.loan.updateMany({
      where: { id, userId, status: 'active' }, data: { status: 'stopped' },
    });
    return this.get(userId, id);
  }

  private async get(userId: string, id: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id, userId }, include: { account: { select: { id: true, name: true } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    return this.serialize(loan);
  }

  private serialize(loan: Loan & { account?: { id: string; name: string } }) {
    const payments = paymentSchedule(loan);
    const next = loan.status === 'active' && loan.processedInstallments < payments.length;
    return {
      ...loan, principal: Number(loan.principal), annualRate: Number(loan.annualRate),
      monthlyPayment: payments[0].toNumber(),
      monthlyDecrease: loan.repaymentMethod === 'equal_principal'
        ? payments[0].sub(payments[1]).toNumber() : 0,
      nextRepaymentDate: next ? dueDate(loan, loan.processedInstallments + 1) : null,
      nextPayment: next ? payments[loan.processedInstallments].toNumber() : null,
    };
  }

  async processDue() {
    if (this.running) return;
    this.running = true;
    try {
      const loans = await this.prisma.loan.findMany({ where: { status: 'active' }, select: { id: true } });
      const today = shanghaiDate();
      for (const loan of loans) {
        try { await this.processLoan(loan.id, today); }
        catch (error) { this.logger.error(`贷款 ${loan.id} 记账失败，将自动重试`, error); }
      }
    } catch (error) {
      this.logger.error('贷款还款检查失败，将自动重试', error);
    } finally { this.running = false; }
  }

  // Compare-and-set locks the loan row before recording expenses. The installment unique
  // constraint also prevents duplicates across processes, retries and soft-deleted bills.
  async processLoan(id: string, today: string) {
    await this.prisma.$transaction(async tx => {
      const loan = await tx.loan.findUnique({ where: { id } });
      if (!loan || loan.status !== 'active') return;
      const payments = paymentSchedule(loan);
      let next = loan.processedInstallments;
      while (next < payments.length && dueDate(loan, next + 1) <= today) next++;
      if (next === loan.processedInstallments) return;
      const claimed = await tx.loan.updateMany({
        where: { id, status: 'active', processedInstallments: loan.processedInstallments },
        data: { processedInstallments: next, status: next === payments.length ? 'completed' : 'active' },
      });
      if (!claimed.count) return;
      const categoryId = `loan-repayment-${loan.userId}`;
      await tx.category.upsert({
        where: { id: categoryId },
        update: { type: 'expense', familyId: null, isFamilyShared: false },
        create: { id: categoryId, userId: loan.userId, name: '贷款还款', type: 'expense',
          icon: 'account_balance', color: '#607D8B', isDefault: true },
      });
      for (let index = loan.processedInstallments; index < next; index++) {
        await tx.transaction.create({ data: {
          userId: loan.userId, type: 'expense', amount: payments[index], categoryId,
          accountId: loan.accountId, date: new Date(`${dueDate(loan, index + 1)}T00:00:00.000Z`),
          note: `${loan.name} 第 ${index + 1}/${payments.length} 期还款`, tags: [],
          loanId: loan.id, loanInstallment: index + 1,
        } });
        await tx.account.update({ where: { id: loan.accountId },
          data: { balance: { decrement: payments[index] } } });
      }
    }, { timeout: 30_000 });
  }
}
