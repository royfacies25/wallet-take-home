import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { HttpError } from '../lib/errors';
import { dec } from '../lib/money';
import * as ledger from './ledger';

export async function placeWager(walletId: string, amount: string): Promise<{ wallet: Wallet; entry: WalletTx }> {
  return sequelize.transaction(async (t) => {
    // Lock first, then read the balance: two concurrent wagers serialise here instead of both seeing the old balance.
    const wallet = await Wallet.findByPk(walletId, { lock: t.LOCK.NO_KEY_UPDATE, transaction: t });
    if (!wallet) {
      throw new HttpError(404, 'wallet_not_found');
    }
    if (dec(wallet.balance).lt(amount)) {
      throw new HttpError(422, 'insufficient_balance', { balance: wallet.balance });
    }
    await wallet.update(
      { turnoverAccrued: dec(wallet.turnoverAccrued).plus(amount).toFixed(18) },
      { transaction: t },
    );
    const entry = await ledger.post(wallet, 'wager', dec(amount).negated().toFixed(18), null, t);
    return { wallet, entry };
  });
}
