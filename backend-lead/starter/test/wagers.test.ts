import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
import { createMember, expectLedgerMatchesBalance, fundedMember, wager } from './helpers';

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

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet and accrues turnover', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '100');

    const res = await wager(app, walletId, '10.25');

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('89.75');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('89.750000000000000000');
    expect(wallet?.turnoverAccrued).toBe('10.250000000000000000');
    await expectLedgerMatchesBalance(walletId);
  });

  it('allows a wager of the whole balance', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '10');
    const res = await wager(app, walletId, '10');
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('0');
  });

  it('rejects a wager above the balance and changes nothing', async () => {
    const { walletId } = await fundedMember(app, 'alice01', '10');

    const res = await wager(app, walletId, '10.000000000000000001');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('10.000000000000000000');
    expect(wallet?.turnoverAccrued).toBe('0.000000000000000000');
  });

  it('rejects a wager on an empty wallet', async () => {
    const { walletId } = await createMember(app, 'alice01');
    const res = await wager(app, walletId, '1');
    expect(res.status).toBe(422);
  });

  it('returns 404 for an unknown wallet and 400 for a bad id', async () => {
    expect((await wager(app, '00000000-0000-4000-8000-000000000000', '1')).status).toBe(404);
    expect((await wager(app, 'not-a-uuid', '1')).status).toBe(400);
  });

  it('cannot be overdrawn by concurrent wagers', async () => {
    const server = app.listen(0);
    try {
      for (let round = 0; round < 5; round++) {
        const { walletId } = await fundedMember(app, `alice${round}`, '100');

        // 10 wagers of 30 against 100: exactly 3 can succeed.
        const results = await Promise.all(Array.from({ length: 10 }, () => wager(server, walletId, '30')));

        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([...Array(3).fill(201), ...Array(7).fill(422)]);
        const wallet = await Wallet.findByPk(walletId);
        expect(wallet?.balance).toBe('10.000000000000000000');
        expect(wallet?.turnoverAccrued).toBe('90.000000000000000000');
        expect(await WalletTx.count({ where: { walletId, type: 'wager' } })).toBe(3);
        await expectLedgerMatchesBalance(walletId);
      }
    } finally {
      server.close();
    }
  });
});
