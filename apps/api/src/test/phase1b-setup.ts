import 'dotenv/config';
import { requirePhase1bQaDatabase } from './phase1b-database-safety.js';
process.env.DATABASE_URL = requirePhase1bQaDatabase(
  process.env.DATABASE_URL,
  process.env.GST_PHASE1B_QA_AUTHORIZED,
);
process.env.NODE_ENV = 'test';
