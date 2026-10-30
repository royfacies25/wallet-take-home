import { Router } from 'express';
import { z } from 'zod';
import { dec } from '../lib/money';
import * as depositService from '../services/depositService';
import { isDecimal, moneyString } from './schemas';

export const depositsRouter = Router();

const createDepositBody = z
  .object({
    memberId: z.string().uuid(),
    amount: moneyString,
    turnoverMultiplier: z.number().int().min(0).default(1),
  })
  // The requirement it adds must still fit DECIMAL(36,18), or the callback could never complete.
  .refine((b) => !isDecimal(b.amount) || dec(b.amount).times(b.turnoverMultiplier).lt('1e18'), {
    message: 'amount x turnoverMultiplier is too large',
    path: ['turnoverMultiplier'],
  });

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const deposit = await depositService.createDeposit(body.memberId, body.amount, body.turnoverMultiplier);
    res.status(201).json({
      id: deposit.id,
      pspRef: deposit.pspRef,
      status: deposit.status,
      amount: deposit.amount,
    });
  } catch (err) {
    next(err);
  }
});
