import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTx, IdempotencyKey, WalletTx } from '../src/db/models';
import { callback, createMember, deposit, expectLedgerMatchesBalance, fundedMember, wager, withdraw } from './helpers';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Idempotency-Key', () => {
  it('replays a retried wager instead of placing it twice', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100', 0);

    const first = await wager(app, walletId, '30', 'key-1');
    const retry = await wager(app, walletId, '30', 'key-1');

    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(1);
    await expectLedgerMatchesBalance(walletId);
  });

  it('places one wager when the same key arrives concurrently', async () => {
    const server = app.listen(0);
    try {
      for (let round = 0; round < 5; round++) {
        const { walletId } = await fundedMember(app, `alice${round}`, '100', 0);

        const results = await Promise.all(Array.from({ length: 10 }, () => wager(server, walletId, '30', 'same-key')));

        expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
        expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
        expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(1);
        await expectLedgerMatchesBalance(walletId);
      }
    } finally {
      server.close();
    }
  });

  it('rejects a key reused for a different request', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100', 0);
    await wager(app, walletId, '30', 'key-1');

    const res = await wager(app, walletId, '40', 'key-1');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('idempotency_key_reused');
    expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(1);
  });

  it('treats 30 and 30.0 as the same request', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100', 0);
    await wager(app, walletId, '30', 'key-1');
    const retry = await wager(app, walletId, '30.0', 'key-1');
    expect(retry.status).toBe(201);
    expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(1);
  });

  it('treats different keys as different requests', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100', 0);
    await wager(app, walletId, '30', 'key-1');
    await wager(app, walletId, '30', 'key-2');
    expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(2);
  });

  it('does not store a failed attempt, so a later retry can succeed', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');

    const failed = await wager(app, walletId, '30', 'key-1');
    expect(failed.status).toBe(422);
    expect(await IdempotencyKey.count()).toBe(0);

    const pspRef = await deposit(app, memberId, '100', 0);
    await callback(app, pspRef, 'completed', '100');

    const retry = await wager(app, walletId, '30', 'key-1');
    expect(retry.status).toBe(201);
  });

  it('replays a retried withdrawal', async () => {
    const { memberId, walletId } = await fundedMember(app, 'alice01', '100', 0);

    const first = await withdraw(app, memberId, '40', 'w-1');
    const retry = await withdraw(app, memberId, '40', 'w-1');

    expect(retry.body).toEqual(first.body);
    expect(await FundingTx.count({ where: { type: 'withdrawal' } })).toBe(1);
    await expectLedgerMatchesBalance(walletId);
  });

  it('replays a retried deposit with the same pspRef', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const send = () =>
      request(app).post('/deposits').set('Idempotency-Key', 'd-1').send({ memberId, amount: '50' });

    const first = await send();
    const retry = await send();

    expect(retry.body.pspRef).toBe(first.body.pspRef);
    expect(await FundingTx.count({ where: { type: 'deposit' } })).toBe(1);
  });

  it('rejects an empty key', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100', 0);
    const res = await request(app).post(`/wallets/${walletId}/wagers`).set('Idempotency-Key', '').send({ amount: '1' });
    expect(res.status).toBe(400);
  });
});
