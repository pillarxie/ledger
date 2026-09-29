# 贷款与自动还款

部署顺序：先使用 `pnpm exec prisma migrate deploy` 在目标数据库应用迁移，再运行
`pnpm exec prisma generate`、`pnpm build`，最后重启服务。迁移新增 loans 表及账单贷款关联，
不改写旧账单。本次开发未连接生产数据库或执行数据库迁移。

API：GET /api/loans 获取当前用户的全部贷款；POST /api/loans 创建；
POST /api/loans/:id/stop 停止未来记账，保留既有支出。沿用全局 JWT 及标准响应封装。
创建字段为 name、principal、annualRate（百分数）、years（1–50 整年）、startDate
（YYYY-MM-DD）、repaymentDay（1–31）、accountId、repaymentMethod
（equal_payment 等额本息 / equal_principal 等额本金）。
返回上述字段及 id、status（active/completed/stopped）、processedInstallments、
monthlyPayment（首期金额）、monthlyDecrease、nextRepaymentDate、nextPayment、account。
processedInstallments 包含被跳过的历史期次；monthlyDecrease 为前两期之差，实际金额按分舍入。

首期是开始日期的次月还款日，月份没有该日则取月末，总期数始终为 years × 12。
创建前已到期的期次不记账，创建当天到期的期次立即入账。历史期次仍参与本金和利息计算，
不会将贷款重新从第一期计算。金额精确到分，最后一期归还剩余本金并结算当期利息。
极小本金可能出现零金额月供，末期结清剩余本金；不生成负金额支出。

服务启动及每分钟检查到期计划，按 Asia/Shanghai 判断当前日期；账单日期沿用项目合同，
存为还款日 UTC 零点。运行中无需打开客户端；服务停机时无法实时记账，恢复后自动补齐
贷款创建以来遗漏的到期期次。该功能只记录支出和减少账面账户余额，不执行银行扣款。
账户余额允许为负，规则与现有普通支出一致。

同一数据库事务内认领期次、创建 expense 账单并扣账户余额，认领使用条件更新避免多实例
并发重复执行，并由 (loanId, loanInstallment) 唯一索引兜底。失败时整批回滚，下轮重试。
删除已生成的普通账单会按原功能回补余额，但不回退贷款期次或重新生成该笔账单。
有贷款关联的账户不能删除（含已停止或完成的贷款），保留历史引用。

自动账单使用个人专用“贷款还款”分类。入账时确保其为个人 expense 类别，避免用户编辑
分类后产生收入类型或家庭分类的非法关联。生成账单及账户变化沿用现有同步接口传递；
贷款计划本身由服务端管理并通过贷款接口读取，不支持离线新建，也不属于现有本地备份。
