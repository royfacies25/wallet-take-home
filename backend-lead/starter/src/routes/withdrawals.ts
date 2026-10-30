import { Router } from 'express';
import { z } from 'zod';
import { dec } from '../lib/money';
import * as idempotency from '../services/idempotency';
import * as withdrawalService from '../services/withdrawalService';
import { idempotencyKey, moneyString } from './schemas';

export const withdrawalsRouter = Router();

const withdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: moneyString,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = withdrawalBody.parse(req.body);
    const key = idempotencyKey.parse(req.header('Idempotency-Key'));
    const result = await idempotency.run(`withdrawal:${body.memberId}`, key, { ...body, amount: dec(body.amount).toFixed(18) }, async (t) => {
      const { wallet, withdrawal } = await withdrawalService.requestWithdrawal(body.memberId, body.amount, t);
      return {
        status: 201,
        body: { id: withdrawal.id, status: withdrawal.status, amount: withdrawal.amount, balance: wallet.balance },
      };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});
