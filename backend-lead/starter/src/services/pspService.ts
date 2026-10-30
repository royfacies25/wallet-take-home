import { sequelize } from '../db/sequelize';
import { FundingTx, Wallet } from '../db/models';
import { FundingTxStatus } from '../db/models/fundingTx';
import { HttpError } from '../lib/errors';
import { dec } from '../lib/money';
import * as ledger from './ledger';

export type CallbackStatus = 'completed' | 'failed';

const nextStatus: Record<CallbackStatus, FundingTxStatus> = {
  completed: 'Completed',
  failed: 'Failed',
};

export async function handleCallback(pspRef: string, status: CallbackStatus, amount: string): Promise<FundingTx> {
  return sequelize.transaction(async (t) => {
    // Row lock: a concurrent duplicate waits here, then sees the status this one wrote.
    const deposit = await FundingTx.findOne({
      where: { pspRef, type: 'deposit' },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!deposit) {
      // eslint-disable-next-line no-console
      console.warn(`psp callback for unknown pspRef ${pspRef}`);
      throw new HttpError(404, 'unknown_psp_ref');
    }

    if (deposit.reviewReason) {
      // eslint-disable-next-line no-console
      console.warn(`psp callback ${status} ${amount} on ${pspRef} ignored: held for ${deposit.reviewReason}`);
      return deposit;
    }

    if (deposit.status !== 'Pending') {
      if (deposit.status === nextStatus[status]) {
        if (status === 'completed' && !dec(amount).eq(deposit.amount)) {
          // eslint-disable-next-line no-console
          console.warn(`psp repeat on ${pspRef} reports ${amount}, already credited ${deposit.amount}`);
        }
        return deposit;
      }
      throw new HttpError(409, 'invalid_transition', { from: deposit.status, to: nextStatus[status] });
    }

    if (status === 'failed') {
      return deposit.update({ status: 'Failed' }, { transaction: t });
    }

    if (!dec(amount).eq(deposit.amount)) {
      // eslint-disable-next-line no-console
      console.warn(`psp amount mismatch on ${pspRef}: expected ${deposit.amount}, got ${amount}`);
      return deposit.update({ receivedAmount: amount, reviewReason: 'amount_mismatch' }, { transaction: t });
    }

    const wallet = await Wallet.findByPk(deposit.walletId, { lock: t.LOCK.NO_KEY_UPDATE, transaction: t });
    if (!wallet) {
      throw new Error(`wallet ${deposit.walletId} missing for deposit ${deposit.id}`);
    }
    if (deposit.turnoverMultiplier === null) {
      throw new Error(`deposit ${deposit.id} has no turnover multiplier`);
    }
    const added = dec(deposit.amount).times(deposit.turnoverMultiplier);
    await wallet.update(
      { turnoverRequired: dec(wallet.turnoverRequired).plus(added).toFixed(18) },
      { transaction: t },
    );
    await ledger.post(wallet, 'deposit', deposit.amount, deposit.id, t);
    return deposit.update({ status: 'Completed', receivedAmount: amount }, { transaction: t });
  });
}
