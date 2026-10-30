import { Router } from 'express';
import { z } from 'zod';
import * as pspService from '../services/pspService';
import { moneyString } from './schemas';

export const pspRouter = Router();

const callbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: moneyString,
});

pspRouter.post('/callbacks', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const deposit = await pspService.handleCallback(body.pspRef, body.status, body.amount);
    res.json({
      id: deposit.id,
      pspRef: deposit.pspRef,
      status: deposit.status,
      reviewReason: deposit.reviewReason,
    });
  } catch (err) {
    next(err);
  }
});
