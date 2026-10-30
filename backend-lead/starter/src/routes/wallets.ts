import { Router } from 'express';
import { z } from 'zod';
import { dec } from '../lib/money';
import * as wagerService from '../services/wagerService';
import { moneyString } from './schemas';

export const walletsRouter = Router();

const walletParams = z.object({ walletId: z.string().uuid() });
const wagerBody = z.object({ amount: moneyString });

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = walletParams.parse(req.params);
    const body = wagerBody.parse(req.body);
    const { wallet, entry } = await wagerService.placeWager(walletId, body.amount);
    res.status(201).json({
      id: entry.id,
      walletId: wallet.id,
      amount: dec(body.amount).toFixed(18),
      balance: wallet.balance,
      turnoverAccrued: wallet.turnoverAccrued,
    });
  } catch (err) {
    next(err);
  }
});
