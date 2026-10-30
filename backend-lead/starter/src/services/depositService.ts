import { randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { FundingTx, Wallet } from '../db/models';
import { HttpError } from '../lib/errors';

export async function createDeposit(
  memberId: string,
  amount: string,
  turnoverMultiplier: number,
  t?: Transaction,
): Promise<FundingTx> {
  const wallet = await Wallet.findOne({ where: { memberId }, transaction: t });
  if (!wallet) {
    throw new HttpError(404, 'member_not_found');
  }
  return FundingTx.create({
    walletId: wallet.id,
    type: 'deposit',
    status: 'Pending',
    amount,
    turnoverMultiplier,
    pspRef: `psp_${randomUUID()}`,
  }, { transaction: t });
}
