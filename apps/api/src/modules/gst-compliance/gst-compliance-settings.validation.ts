import { z } from 'zod';

export const updateGstComplianceSettingsSchema = z.object({
  expectedVersion: z.number().int().min(0).max(2147483646),
  integrationMode: z.enum(['DEMO', 'LIVE']).optional(),
  onlineGstinVerificationEnabled: z.boolean().optional(),
  gstinVerificationLevel: z.enum(['BASIC', 'COMPLETE']).optional(),
  ewayBillGenerationEnabled: z.boolean().optional(),
  confirmLiveActivation: z.boolean().optional(),
}).strict().refine((value) =>
  value.integrationMode !== undefined || value.onlineGstinVerificationEnabled !== undefined ||
  value.gstinVerificationLevel !== undefined || value.ewayBillGenerationEnabled !== undefined,
{ message: 'At least one setting is required' });
