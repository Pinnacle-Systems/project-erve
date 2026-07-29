import 'dotenv/config';
import { requireSafeTestDatabaseUrl } from './database-safety.js';

const target = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = target.url;
