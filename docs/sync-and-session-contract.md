# 同步、备份与登录会话

## 登录会话

新签发的 JWT 含 `tokenType`（access / refresh）、随机 `sessionId` 和 `jti`。
受保护 API 仅接受 access token；刷新仅接受 refresh token。
刷新保留 sessionId，退出会将整个会话写入 Redis 撤销记录，因此已签发的
access 和 refresh token 都不再可用。旧的无类型 token 需要重新登录。
沿用 JWT_SECRET、JWT_ACCESS_TOKEN_EXPIRES_IN、JWT_REFRESH_TOKEN_EXPIRES_IN，
过期配置单位为秒。撤销检查在 Redis 不可用时不会放行。

本期不开放找回密码。POST /auth/forgot-password 返回 503，不发邮件、
不生成或返回重置令牌。未添加 SMTP 依赖或环境变量。

## 同步

POST /sync/pull 接收 `{deviceId,lastSyncAt}`。首次全量拉取用
`1970-01-01T00:00:00.000Z`，后续游标使用返回的 syncTime。
事务包含本人记录和当前家庭共享记录，包含软删除标记；账户和预算只包含本人。
分类、账户、预算为硬删除，客户端需要定期全量刷新，而不能仅依赖增量游标清理缓存。

POST /sync/push 先保存分类和账户，再保存账单和预算。
客户端账单离线队列只推送 transactions，不推送账户余额快照。
账单新增、修改和恢复均在 Serializable 事务中更新账户余额；重复发送同一版本
通过回滚旧账单影响再计入新账单影响，避免重复扣款。
每条自动推送携带 expectedUpdatedAt，服务端在同一事务内比较当前版本；
版本不同且内容不同会失败，完全相同的网络重试直接返回成功，不改变余额或更新时间。
自动删除在 resolve 条目中携带 expectedUpdatedAt；手动确认冲突可不携带。
普通 push 不自动复活软删除记录，只有明确的客户端冲突解决方案可以复活。
事务冲突会计入 failed，客户端应保留该项并重试。

POST /sync/resolve 删除分支校验账单归属，并与余额回滚放在同一事务内。
重复删除不会重复回滚余额。普通更新只能修改本人数据；家庭 ID 必须是当前成员。

## 恢复备份

POST /sync/restore 请求为平铺对象：

```json
{
  "deviceId": "client-device-id",
  "ownerId": "current-user-id",
  "categories": [],
  "accounts": [],
  "transactions": [],
  "budgets": []
}
```

字段沿用 PushDataDto；金额为数字且账单/预算金额大于零，最多两位小数。
不要提交额外快照元数据、软删除账单、其他人的共享记录或家庭成员权限。
ownerId 必须等于 JWT 用户。相同 ID 的本人记录保留服务端版本并计 skipped；
其他用户拥有的 ID 拒绝写入。家庭记录仍验证当前成员关系，不能恢复历史权限。

新账户的初始余额等于快照余额减去快照内该账户账单净额，再按缺失账单逐笔入账；
已有账户仅增加本次成功恢复的缺失账单差额。恢复顺序为分类、账户、账单、预算。
逐项失败不会停止其他条目，响应包含各类型的 success / failed / skipped 计数。
如果有 failed，必须提示用户恢复不完整并允许重试；不得显示全部恢复成功。

## 预算与账本范围

isActive 仅表示启用/停用，列表会包含停用预算；DELETE 预算是真正删除。
不传 familyId 的预算列表和汇总仅取个人预算（familyId 为 null）。
进度返回 budget.familyId、period、amount、category、startDate、endDate。
个人交易列表/收支汇总仅统计本人；指定家庭则校验成员身份，只统计该家庭共享账单。

## 独立 HTTP 验证

`LEDGER_RUN_ISOLATED_SMOKE=1 node test/isolated-smoke.cjs` 仅在显式授权时执行。
脚本连接本机 PostgreSQL 维护库 postgres，创建随机 `ledger_wiring_test_*` 库，
向该临时库推送 schema，在随机空闲端口启动服务后执行 HTTP 断言并销毁临时库。
Redis 使用 DB15，只删除本次随机用户和 token 对应的精确键，不使用 FLUSHDB。
现有 ledger_db 的内容不会被读取或修改。
