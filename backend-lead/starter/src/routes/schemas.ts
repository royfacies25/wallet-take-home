import { z } from 'zod';
import { dec } from '../lib/money';

// Money arrives as a plain decimal string. At most 18 digits each side, to fit DECIMAL(36,18).
const decimalPattern = /^\d{1,18}(\.\d{1,18})?$/;

// zod still runs refine after a failed regex, so the refine must not parse anything the regex rejected.
export const moneyString = z
  .string()
  .regex(decimalPattern, 'must be a decimal string')
  .refine((v) => !decimalPattern.test(v) || dec(v).gt(0), 'must be positive');
