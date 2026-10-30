import { Router } from 'express';
import { z } from 'zod';
import { dec } from '../lib/money';
import * as idempotency from '../services/idempotency';
import * as wagerService from '../services/wagerService';
import { idempotencyKey, moneyString } from './schemas';

export const walletsRouter = Router();

const walletParams = z.object({ walletId: z.string().uuid() });
const wagerBody = z.object({ amount: moneyString });

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = walletParams.parse(req.params);
    const body = wagerBody.parse(req.body);
    const key = idempotencyKey.parse(req.header('Idempotency-Key'));
    const result = await idempotency.run(`wager:${walletId}`, key, { ...body, amount: dec(body.amount).toFixed(18) }, async (t) => {
      const { wallet, entry } = await wagerService.placeWager(walletId, body.amount, t);
      return {
        status: 201,
        body: {
          id: entry.id,
          walletId: wallet.id,
          amount: dec(body.amount).toFixed(18),
          balance: wallet.balance,
          turnoverAccrued: wallet.turnoverAccrued,
        },
      };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});
