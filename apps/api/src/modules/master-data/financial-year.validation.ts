import { z } from 'zod';
import { parseStrictCalendarDate } from './financial-year.util.js';

export const resolveFinancialYearQuerySchema = z.object({
  date: z.string().refine((value) => parseStrictCalendarDate(value) !== null, {
    message: 'date must be a valid calendar date in YYYY-MM-DD format',
  }),
});
