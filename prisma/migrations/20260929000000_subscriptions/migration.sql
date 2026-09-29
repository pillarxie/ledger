CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "cycle" TEXT NOT NULL, "amount" DECIMAL(15,2) NOT NULL,
  "firstChargeDate" TEXT NOT NULL, "processedInstallments" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active', "stoppedAt" TIMESTAMP(3), "lastChargeDate" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
ALTER TABLE "transactions" ADD COLUMN "subscriptionId" TEXT, ADD COLUMN "subscriptionInstallment" INTEGER;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "transactions_subscriptionId_subscriptionInstallment_key" ON "transactions"("subscriptionId", "subscriptionInstallment");
