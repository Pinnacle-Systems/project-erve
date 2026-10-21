import { describe, it, expect } from 'vitest';
import { requirePhase1bQaDatabase } from '../../test/phase1b-database-safety.js';
describe('explicit Phase 1B QA target guard', () => {
  it('accepts only the authorized isolated name, loopback port and owner', () => {
    expect(
      requirePhase1bQaDatabase(
        'postgresql://gstphase1b:synthetic@127.0.0.1:55433/erve_gst_phase1b_qa',
        'true',
      ),
    ).toContain('erve_gst_phase1b_qa');
  });
  it.each([
    ['postgresql://gstphase1b:synthetic@127.0.0.1:55433/erve_gst_phase1b_qa', undefined],
    ['postgresql://gstphase1b:synthetic@127.0.0.1:55432/erve_gst_phase1a_qa', 'true'],
    ['postgresql://gstphase1b:synthetic@127.0.0.1:5432/erve_gst_phase1b_qa', 'true'],
    ['postgresql://gstphase1b:synthetic@remote.example:55433/erve_gst_phase1b_qa', 'true'],
    ['postgresql://postgres:synthetic@127.0.0.1:55433/erve_gst_phase1b_qa', 'true'],
  ])('rejects unauthorized or other targets', (url, authorization) =>
    expect(() => requirePhase1bQaDatabase(url, authorization)).toThrow(),
  );
});
