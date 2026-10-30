import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTx, Wallet, WalletTx } from '../src/db/models';
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

describe('POST /withdrawals', () => {
  it('blocks a withdrawal until turnover is met, then allows it', async () => {
    // Deposit 100 at 2x: 200 of turnover required before any withdrawal.
    const { memberId, walletId } = await fundedMember(app, 'alice01', '100', 2);

    const blocked = await withdraw(app, memberId, '10');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toBe('turnover_not_met');
    expect(blocked.body.outstanding).toBe('200.000000000000000000');

    // Wagers only accrue turnover; winnings are out of scope, so the balance shrinks while turnover builds.
    await wager(app, walletId, '60');
    const stillBlocked = await withdraw(app, memberId, '10');
    expect(stillBlocked.body.outstanding).toBe('140.000000000000000000');

    // Top up and wager the rest so turnover reaches exactly the requirement.
    const pspRef = await deposit(app, memberId, '150', 0);
    await callback(app, pspRef, 'completed', '150');
    await wager(app, walletId, '140');

    const allowed = await withdraw(app, memberId, '20');
    expect(allowed.status).toBe(201);
    expect(allowed.body.status).toBe('Pending');
    expect(allowed.body.balance).toBe('30.000000000000000000');
    await expectLedgerMatchesBalance(walletId);
  });

  it('locks again when a new deposit adds turnover after an unlock', async () => {
    const { memberId, walletId } = await fundedMember(app, 'alice01', '100', 1);
    await wager(app, walletId, '100');
    const pspRef = await deposit(app, memberId, '50', 2);
    await callback(app, pspRef, 'completed', '50');

    const res = await withdraw(app, memberId, '10');

    expect(res.status).toBe(422);
    expect(res.body.outstanding).toBe('100.000000000000000000');
  });

  it('does not count a pending or held deposit towards the requirement', async () => {
    const { memberId } = await fundedMember(app, 'alice01', '100', 0);
    await deposit(app, memberId, '50', 3);
    const held = await deposit(app, memberId, '70', 3);
    await callback(app, held, 'completed', '60');

    const res = await withdraw(app, memberId, '10');

    expect(res.status).toBe(201);
  });

  it('does not lock a deposit made with multiplier 0', async () => {
    const { memberId } = await fundedMember(app, 'alice01', '100', 0);
    const res = await withdraw(app, memberId, '100');
    expect(res.status).toBe(201);
  });

  it('debits at once and records a pending withdrawal with its ledger entry', async () => {
    const { memberId, walletId } = await fundedMember(app, 'alice01', '100', 0);

    const res = await withdraw(app, memberId, '40');

    const tx = await FundingTx.findByPk(res.body.id);
    expect(tx?.type).toBe('withdrawal');
    expect(tx?.status).toBe('Pending');
    const entry = await WalletTx.findOne({ where: { fundingTxId: res.body.id } });
    expect(entry?.amount).toBe('-40.000000000000000000');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('60.000000000000000000');
    await expectLedgerMatchesBalance(walletId);
  });

  it('rejects a withdrawal above the balance', async () => {
    const { memberId } = await fundedMember(app, 'alice01', '100', 0);
    const res = await withdraw(app, memberId, '100.01');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
  });

  it('returns 404 for an unknown member', async () => {
    const res = await withdraw(app, '00000000-0000-4000-8000-000000000000', '1');
    expect(res.status).toBe(404);
  });

  it('cannot be overdrawn by concurrent withdrawals', async () => {
    const server = app.listen(0);
    try {
      for (let round = 0; round < 5; round++) {
        const { memberId, walletId } = await fundedMember(app, `alice${round}`, '100', 0);

        const results = await Promise.all(Array.from({ length: 10 }, () => withdraw(server, memberId, '30')));

        expect(results.map((r) => r.status).sort()).toEqual([...Array(3).fill(201), ...Array(7).fill(422)]);
        const wallet = await Wallet.findByPk(walletId);
        expect(wallet?.balance).toBe('10.000000000000000000');
        await expectLedgerMatchesBalance(walletId);
      }
    } finally {
      server.close();
    }
  });

  it('rejects a member with no wallet activity', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const res = await withdraw(app, memberId, '1');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
  });
});
