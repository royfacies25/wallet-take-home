import { Router } from 'express';
import { z } from 'zod';
import * as withdrawalService from '../services/withdrawalService';
import { moneyString } from './schemas';

export const withdrawalsRouter = Router();

const withdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: moneyString,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = withdrawalBody.parse(req.body);
    const { wallet, withdrawal } = await withdrawalService.requestWithdrawal(body.memberId, body.amount);
    res.status(201).json({
      id: withdrawal.id,
      status: withdrawal.status,
      amount: withdrawal.amount,
      balance: wallet.balance,
    });
  } catch (err) {
    next(err);
  }
});
