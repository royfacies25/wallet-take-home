import request from 'supertest';
import { Express } from 'express';
import { Server } from 'http';
import { Wallet, WalletTx } from '../src/db/models';
import { dec } from '../src/lib/money';

export async function createMember(app: Express, username: string): Promise<{ memberId: string; walletId: string }> {
  const res = await request(app).post('/members').send({ username });
  return { memberId: res.body.member.id, walletId: res.body.wallet.id };
}

export async function deposit(app: Express, memberId: string, amount: string, turnoverMultiplier = 1): Promise<string> {
  const res = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  return res.body.pspRef;
}

export function callback(app: Express | Server, pspRef: string, status: 'completed' | 'failed', amount: string) {
  return request(app).post('/psp/callbacks').send({ pspRef, status, amount });
}

// The ledger must explain the balance exactly: SUM(amount) and the last balance_after both equal it.
export async function expectLedgerMatchesBalance(walletId: string): Promise<void> {
  const wallet = await Wallet.findByPk(walletId);
  const entries = await WalletTx.findAll({ where: { walletId }, order: [['createdAt', 'ASC']] });
  const sum = entries.reduce((acc, e) => acc.plus(e.amount), dec(0));
  expect(sum.toFixed(18)).toBe(wallet!.balance);
  if (entries.length > 0) {
    expect(entries[entries.length - 1].balanceAfter).toBe(wallet!.balance);
  }
}

export async function fundedMember(
  app: Express,
  username: string,
  amount: string,
  turnoverMultiplier = 1,
): Promise<{ memberId: string; walletId: string }> {
  const member = await createMember(app, username);
  const pspRef = await deposit(app, member.memberId, amount, turnoverMultiplier);
  await callback(app, pspRef, 'completed', amount);
  return member;
}

export function wager(app: Express | Server, walletId: string, amount: string) {
  return request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
}

export function withdraw(app: Express | Server, memberId: string, amount: string) {
  return request(app).post('/withdrawals').send({ memberId, amount });
}
