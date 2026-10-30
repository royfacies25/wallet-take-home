import { Transaction } from 'sequelize';
import { Wallet, WalletTx } from '../db/models';
import { WalletTxType } from '../db/models/walletTx';
import { dec } from '../lib/money';

// The only place a balance changes. Caller must hold the wallet row lock inside transaction `t`.
export async function post(
  wallet: Wallet,
  type: WalletTxType,
  amount: string,
  fundingTxId: string | null,
  t: Transaction,
): Promise<WalletTx> {
  const balanceAfter = dec(wallet.balance).plus(amount).toFixed();
  await wallet.update({ balance: balanceAfter }, { transaction: t });
  return WalletTx.create({ walletId: wallet.id, type, amount, balanceAfter, fundingTxId }, { transaction: t });
}
