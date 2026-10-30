import { sequelize } from '../src/db/sequelize';
import { FundingTx, Member, Wallet, WalletTx } from '../src/db/models';

// The service is the first line of defence. These check the database still says no if a code path gets it wrong.
beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function setup() {
  const member = await Member.create({ username: 'alice01' });
  const wallet = await Wallet.create({ memberId: member.id, balance: '50' });
  const deposit = await FundingTx.create({
    walletId: wallet.id,
    type: 'deposit',
    status: 'Completed',
    amount: '50',
    turnoverMultiplier: 1,
    pspRef: 'psp_test',
  });
  const entry = await WalletTx.create({
    walletId: wallet.id,
    type: 'deposit',
    amount: '50',
    balanceAfter: '50',
    fundingTxId: deposit.id,
  });
  return { wallet, deposit, entry };
}

it('rejects a second ledger entry for the same funding tx', async () => {
  const { wallet, deposit } = await setup();
  await expect(
    WalletTx.create({ walletId: wallet.id, type: 'deposit', amount: '50', balanceAfter: '100', fundingTxId: deposit.id }),
  ).rejects.toThrow();
});

it('rejects updates and deletes on the ledger', async () => {
  const { entry } = await setup();
  await expect(entry.update({ amount: '60' })).rejects.toThrow(/append-only/);
  await expect(entry.destroy()).rejects.toThrow(/append-only/);
});

it('rejects a negative balance', async () => {
  const { wallet } = await setup();
  await expect(wallet.update({ balance: '-0.000000000000000001' })).rejects.toThrow();
});

it('rejects leaving a terminal status', async () => {
  const { deposit } = await setup();
  await expect(deposit.update({ status: 'Failed' })).rejects.toThrow(/cannot move from Completed/);
});
