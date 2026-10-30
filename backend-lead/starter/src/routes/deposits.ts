import { Router } from 'express';
import { z } from 'zod';
import * as depositService from '../services/depositService';
import { moneyString } from './schemas';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: moneyString,
  turnoverMultiplier: z.number().int().min(0).default(1),
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
