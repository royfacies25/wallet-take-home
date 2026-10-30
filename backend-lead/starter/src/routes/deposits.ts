import { Router } from 'express';
import { z } from 'zod';
import { dec } from '../lib/money';
import * as depositService from '../services/depositService';
import * as idempotency from '../services/idempotency';
import { idempotencyKey, isDecimal, moneyString } from './schemas';

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
    const key = idempotencyKey.parse(req.header('Idempotency-Key'));
    const result = await idempotency.run(`deposit:${body.memberId}`, key, { ...body, amount: dec(body.amount).toFixed(18) }, async (t) => {
      const deposit = await depositService.createDeposit(body.memberId, body.amount, body.turnoverMultiplier, t);
      return {
        status: 201,
        body: { id: deposit.id, pspRef: deposit.pspRef, status: deposit.status, amount: deposit.amount },
      };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});
