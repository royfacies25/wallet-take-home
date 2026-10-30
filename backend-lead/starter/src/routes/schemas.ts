import { z } from 'zod';
import { dec } from '../lib/money';

// Money arrives as a plain decimal string. Up to 18 places to match DECIMAL(36,18).
export const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,18})?$/, 'must be a decimal string')
  .refine((v) => dec(v).gt(0), 'must be positive');
