import { z } from 'zod';
import { dec } from '../lib/money';

// Money arrives as a plain decimal string. At most 18 digits each side, to fit DECIMAL(36,18).
export const moneyString = z
  .string()
  .regex(/^\d{1,18}(\.\d{1,18})?$/, 'must be a decimal string')
  .refine((v) => dec(v).gt(0), 'must be positive');
