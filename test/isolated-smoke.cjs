// Explicit opt-in. Creates a unique temporary database; never uses ledger_db.
// Redis DB 15 is used without FLUSHDB; only this run's exact auth keys are removed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const Redis = require('ioredis');
const net = require('node:net');

async function main() {
  if (process.env.LEDGER_RUN_ISOLATED_SMOKE !== '1') throw new Error('Set LEDGER_RUN_ISOLATED_SMOKE=1 explicitly');
  const suffix = crypto.randomBytes(6).toString('hex');
  const database = `ledger_wiring_test_${suffix}`;
  assert.match(database, /^ledger_wiring_test_[0-9a-f]{12}$/);
  const adminUrl = new URL(process.env.LEDGER_SMOKE_ADMIN_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres');
  assert.equal(adminUrl.pathname, '/postgres', 'Admin connection must use maintenance database postgres');
  const admin = new Client({ connectionString: adminUrl.toString() });
  const redis = new Redis('redis://127.0.0.1:6379/15', { lazyConnect: true });
  const keys = new Set();
  let app;
  let created = false;
  let checks = 0;
  let output = '';
  const passed = label => { checks++; console.log(`PASS ${label}`); };
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    adminUrl.pathname = `/${database}`;
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const env = { ...process.env, DATABASE_URL: adminUrl.toString(), REDIS_URL: 'redis://127.0.0.1:6379/15', JWT_SECRET: crypto.randomBytes(48).toString('hex'), PORT: String(port), NODE_ENV: 'test' };
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema', 'prisma/schema.prisma'], { env, stdio: 'pipe' });
    app = spawn(process.execPath, ['-r', 'ts-node/register', 'src/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.stdout.on('data', chunk => { output += chunk; });
    app.stderr.on('data', chunk => { output += chunk; });
    const base = `http://127.0.0.1:${port}/api`;
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${base}/users/me`); ready = true; break; } catch {}
      if (app.exitCode != null) throw new Error('Isolated service exited before ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Isolated API did not start');
    const request = async (method, path, body, token, expected = 200) => {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result.data;
    };
    const register = async label => {
      const email = `${label}_${suffix}@example.com`;
      keys.add(`login_fail:${email}`);
      const user = await request('POST', '/auth/register', { username: `${label}_${suffix}`, email, password: 'SmokePass123!' }, null, 201);
      for (const token of [user.accessToken, user.refreshToken]) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
        keys.add(`revoked_session:${payload.sessionId}`);
      }
      keys.add(`blacklist:${user.refreshToken}`);
      return user;
    };
    const one = await register('one'); const two = await register('two');
    const token = one.accessToken;
    await request('GET', '/users/me', null, one.refreshToken, 401);
    passed('refresh token cannot authenticate as access token');
    const account = await request('POST', '/accounts', { name: 'Cash', type: 'cash', balance: 100, icon: 'cash', color: '#000000' }, token, 201);
    const category = await request('POST', '/categories', { name: 'Food', type: 'expense', icon: 'food', color: '#000000' }, token, 201);
    assert.equal(typeof account.balance, 'number');
    const record = { id: crypto.randomUUID(), type: 'expense', amount: 12.5, accountId: account.id, categoryId: category.id, date: '2026-09-24', familyId: null, subCategoryId: null, note: null, tags: [], location: null, isFamilyShared: false };
    const push = data => request('POST', '/sync/push', { deviceId: suffix, transactions: [data] }, token, 201);
    assert.equal((await push(record)).transactions.success, 1);
    assert.equal((await push(record)).transactions.success, 1);
    assert.equal((await request('GET', `/accounts/${account.id}`, null, token)).balance, 87.5);
    passed('real database repeated UUID push deducts balance only once and Decimal serializes as number');
    const resolve = (who, data) => request('POST', '/sync/resolve', { transactions: [data] }, who, 201);
    assert.equal((await resolve(two.accessToken, { id: record.id, useServer: false, deleted: true })).transactions.failed, 1);
    assert.equal((await resolve(token, { id: record.id, useServer: false, deleted: true })).transactions.success, 1);
    assert.equal((await resolve(token, { id: record.id, useServer: false, deleted: true })).transactions.success, 1);
    assert.equal((await request('GET', `/accounts/${account.id}`, null, token)).balance, 100);
    assert.equal((await push(record)).transactions.failed, 1);
    assert.equal((await resolve(token, { id: record.id, useServer: false, data: record })).transactions.success, 1);
    passed('delete checks ownership, rolls back once, and requires explicit conflict resolution to revive');
    await request('POST', '/sync/push', { deviceId: suffix, transactions: [{ ...record, amount: '12.50' }] }, token, 400);
    await request('POST', '/sync/restore', { deviceId: suffix, ownerId: one.user.id, transactions: [{ ...record, userId: two.user.id }] }, token, 400);
    passed('real HTTP validation rejects string money and extra userId');
    const restoreAccount = { id: crypto.randomUUID(), name: 'Restore', type: 'cash', balance: 87.5, icon: 'cash', color: '#000000' };
    const restoreRecord = { ...record, id: crypto.randomUUID(), accountId: restoreAccount.id };
    const backup = { deviceId: suffix, ownerId: one.user.id, accounts: [restoreAccount], transactions: [restoreRecord] };
    const first = await request('POST', '/sync/restore', backup, token, 201);
    const second = await request('POST', '/sync/restore', backup, token, 201);
    assert.equal(first.transactions.success, 1); assert.equal(second.transactions.skipped, 1);
    assert.equal((await request('GET', `/accounts/${restoreAccount.id}`, null, token)).balance, 87.5);
    passed('snapshot restore starts from opening balance and repeat restore preserves existing rows');
    const version = (await request('GET', `/transactions/${record.id}`, null, token)).updatedAt;
    assert.equal((await push({ ...record, amount: 20, expectedUpdatedAt: version })).transactions.success, 1);
    assert.equal((await push({ ...record, amount: 30, expectedUpdatedAt: version })).transactions.failed, 1);
    assert.equal((await request('GET', `/accounts/${account.id}`, null, token)).balance, 80);
    passed('transaction compare-and-swap rejects stale writes without changing balance');

    const budget = await request('POST', '/budgets', { amount: 100, period: 'monthly', startDate: '2026-09-01' }, token, 201);
    await request('PUT', `/budgets/${budget.id}`, { isActive: false }, token);
    assert.equal((await request('GET', '/budgets', null, token)).items[0].isActive, false);
    await request('PUT', `/budgets/${budget.id}`, { isActive: true }, token);
    await request('DELETE', `/budgets/${budget.id}`, null, token);
    assert.equal((await request('GET', '/budgets', null, token)).items.length, 0);
    passed('budget disable stays visible, reenable works, delete removes row');
    const family = await request('POST', '/families', { name: 'Smoke family' }, token, 201);
    await request('POST', '/families/join', { inviteCode: family.inviteCode }, two.accessToken, 201);
    const otherAccount = await request('POST', '/accounts', { name: 'Other cash', type: 'cash', balance: 100, icon: 'cash', color: '#000000' }, two.accessToken, 201);
    const otherCategory = await request('POST', '/categories', { name: 'Other food', type: 'expense', icon: 'food', color: '#000000' }, two.accessToken, 201);
    await request('POST', '/transactions', { type: 'expense', amount: 5, accountId: otherAccount.id, categoryId: otherCategory.id, date: '2026-09-24', familyId: family.id, isFamilyShared: true }, two.accessToken, 201);
    await request('POST', '/transactions', { type: 'expense', amount: 7, accountId: otherAccount.id, categoryId: otherCategory.id, date: '2026-09-24', familyId: family.id, isFamilyShared: false }, two.accessToken, 201);
    const personalSummary = await request('GET', '/transactions/summary?startDate=2026-09-01&endDate=2026-09-30', null, token);
    const familySummary = await request('GET', `/transactions/summary?startDate=2026-09-01&endDate=2026-09-30&familyId=${family.id}`, null, token);
    assert.equal(personalSummary.totalExpense, 32.5);
    assert.equal(familySummary.totalExpense, 5);
    const familyList = await request('GET', `/transactions?familyId=${family.id}`, null, token);
    assert.equal(familyList.items.length, 1);
    const family2 = await request('POST', '/families', { name: 'Second family' }, token, 201);
    const familyCategory = await request('POST', '/categories', { name: 'Family food', type: 'expense', icon: 'food', color: '#000000', familyId: family.id, isFamilyShared: true }, token, 201);
    assert.equal((await push({ ...record, id: crypto.randomUUID(), categoryId: familyCategory.id, familyId: family2.id, isFamilyShared: true })).transactions.failed, 1);
    passed('personal/family query scopes and cross-family category bindings are isolated');

    await request('POST', '/auth/forgot-password', { email: one.user.email }, null, 503);
    await request('POST', '/auth/logout', { refreshToken: one.refreshToken }, token, 201);
    await request('GET', '/users/me', null, token, 401);
    await request('POST', '/auth/refresh', { refreshToken: one.refreshToken }, null, 401);
    passed('disabled recovery and logout revoke both tokens');
    console.log(`ISOLATED_SMOKE_OK ${checks} checks`);
  } finally {
    if (app && app.exitCode == null) {
      app.kill('SIGTERM');
      await Promise.race([new Promise(resolve => app.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (app.exitCode == null) app.kill('SIGKILL');
    }
    try {
      await redis.connect();
      if (keys.size) await redis.del(...keys);
    } finally { redis.disconnect(); }
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    console.log(`CLEANUP_OK ${database}; exact test Redis keys removed`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
