import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTx, Wallet, WalletTx } from '../src/db/models';
import { callback, createMember, deposit, expectLedgerMatchesBalance, fundedMember, wager } from './helpers';

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

describe('POST /psp/callbacks', () => {
  it('credits a completed deposit and adds the turnover requirement', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '100.50', 3);

    const res = await callback(app, pspRef, 'completed', '100.50');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Completed');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('100.500000000000000000');
    expect(wallet?.turnoverRequired).toBe('301.500000000000000000');
    await expectLedgerMatchesBalance(walletId);
  });

  it('does not double-credit a duplicate callback', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '50');

    await callback(app, pspRef, 'completed', '50');
    const again = await callback(app, pspRef, 'completed', '50');

    expect(again.status).toBe(200);
    expect(again.body.status).toBe('Completed');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('50.000000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
  });

  it('does not double-credit concurrent duplicate callbacks', async () => {
    // One shared server so the requests really overlap; request(app) starts a server per call and serialises them.
    const server = app.listen(0);
    try {
      for (let round = 0; round < 5; round++) {
        const { memberId, walletId } = await createMember(app, `alice${round}`);
        const pspRef = await deposit(app, memberId, '50');

        const results = await Promise.all(
          Array.from({ length: 10 }, () => callback(server, pspRef, 'completed', '50')),
        );

        expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
        const wallet = await Wallet.findByPk(walletId);
        expect(wallet?.balance).toBe('50.000000000000000000');
        expect(await WalletTx.count({ where: { walletId } })).toBe(1);
        await expectLedgerMatchesBalance(walletId);
      }
    } finally {
      server.close();
    }
  });

  it('settles on one outcome when completed and failed arrive together', async () => {
    const server = app.listen(0);
    try {
      for (let round = 0; round < 5; round++) {
        const { memberId, walletId } = await createMember(app, `alice${round}`);
        const pspRef = await deposit(app, memberId, '50');

        const [done, failed] = await Promise.all([
          callback(server, pspRef, 'completed', '50'),
          callback(server, pspRef, 'failed', '50'),
        ]);

        // Whichever lands first wins; the other is a rejected transition.
        expect([done.status, failed.status].sort()).toEqual([200, 409]);
        const tx = await FundingTx.findOne({ where: { pspRef } });
        const wallet = await Wallet.findByPk(walletId);
        expect(wallet?.balance).toBe(tx?.status === 'Completed' ? '50.000000000000000000' : '0.000000000000000000');
        await expectLedgerMatchesBalance(walletId);
      }
    } finally {
      server.close();
    }
  });

  it('keeps the ledger exact when a callback races wagers on the same wallet', async () => {
    const server = app.listen(0);
    try {
      const { memberId, walletId } = await fundedMember(app, 'alice01', '100');
      const pspRef = await deposit(app, memberId, '40');

      await Promise.all([
        callback(server, pspRef, 'completed', '40'),
        ...Array.from({ length: 5 }, () => wager(server, walletId, '10')),
      ]);

      const wallet = await Wallet.findByPk(walletId);
      expect(wallet?.balance).toBe('90.000000000000000000');
      await expectLedgerMatchesBalance(walletId);
    } finally {
      server.close();
    }
  });

  it('keeps a review hold when a failed callback follows', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '100.50');
    await callback(app, pspRef, 'completed', '90');

    const res = await callback(app, pspRef, 'failed', '90');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pending');
    expect(res.body.reviewReason).toBe('amount_mismatch');
  });

  it('marks a failed deposit without moving money', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '50');

    const res = await callback(app, pspRef, 'failed', '50');

    expect(res.body.status).toBe('Failed');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('0.000000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);
  });

  it.each([
    ['completed', 'failed', 'Completed'],
    ['failed', 'completed', 'Failed'],
  ] as const)('rejects %s then %s', async (first, second, kept) => {
    const { memberId, walletId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '50');
    await callback(app, pspRef, first, '50');

    const res = await callback(app, pspRef, second, '50');

    expect(res.status).toBe(409);
    const tx = await FundingTx.findOne({ where: { pspRef } });
    expect(tx?.status).toBe(kept);
    await expectLedgerMatchesBalance(walletId);
  });

  it('requires a positive amount on a failed callback too', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '50');
    const res = await callback(app, pspRef, 'failed', '0');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown pspRef and writes nothing', async () => {
    const res = await callback(app, 'psp_does_not_exist', 'completed', '50');
    expect(res.status).toBe(404);
    expect(await WalletTx.count()).toBe(0);
  });

  it('holds a deposit for review when the amount differs, and ignores later callbacks', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '100.50');

    const res = await callback(app, pspRef, 'completed', '90');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pending');
    expect(res.body.reviewReason).toBe('amount_mismatch');
    const tx = await FundingTx.findOne({ where: { pspRef } });
    expect(tx?.receivedAmount).toBe('90.000000000000000000');

    const retry = await callback(app, pspRef, 'completed', '100.50');
    expect(retry.body.status).toBe('Pending');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('0.000000000000000000');
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);
  });

  it('treats 100.5 and 100.50 as the same amount', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const pspRef = await deposit(app, memberId, '100.50');
    const res = await callback(app, pspRef, 'completed', '100.5');
    expect(res.body.status).toBe('Completed');
  });
});
