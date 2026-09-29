CREATE TABLE "loans" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "principal" DECIMAL(15,2) NOT NULL,
  "annualRate" DECIMAL(8,4) NOT NULL, "years" INTEGER NOT NULL,
  "startDate" TEXT NOT NULL, "repaymentDay" INTEGER NOT NULL,
  "repaymentMethod" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active',
  "processedInstallments" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loans_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "loans_status_idx" ON "loans"("status");
ALTER TABLE "transactions" ADD COLUMN "loanId" TEXT, ADD COLUMN "loanInstallment" INTEGER;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "transactions_loanId_loanInstallment_key" ON "transactions"("loanId", "loanInstallment");
