import { sequelize } from '../db/sequelize';
import { FundingTx, Wallet } from '../db/models';
import { HttpError } from '../lib/errors';
import { dec } from '../lib/money';
import * as ledger from './ledger';

export async function requestWithdrawal(
  memberId: string,
  amount: string,
): Promise<{ wallet: Wallet; withdrawal: FundingTx }> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findOne({ where: { memberId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) {
      throw new HttpError(404, 'member_not_found');
    }

    const outstanding = dec(wallet.turnoverRequired).minus(wallet.turnoverAccrued);
    if (outstanding.gt(0)) {
      throw new HttpError(422, 'turnover_not_met', {
        turnoverRequired: wallet.turnoverRequired,
        turnoverAccrued: wallet.turnoverAccrued,
        outstanding: outstanding.toFixed(18),
      });
    }
    if (dec(wallet.balance).lt(amount)) {
      throw new HttpError(422, 'insufficient_balance', { balance: wallet.balance });
    }

    // Money leaves the wallet now; a human approves the payout later.
    const withdrawal = await FundingTx.create(
      { walletId: wallet.id, type: 'withdrawal', status: 'Pending', amount },
      { transaction: t },
    );
    await ledger.post(wallet, 'withdrawal', dec(amount).negated().toFixed(18), withdrawal.id, t);
    return { wallet, withdrawal };
  });
}
