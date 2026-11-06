import { useState } from 'react';
import { Panel } from '@erve/layout';
import { GstinVerificationField } from './GstinVerificationField.js';

/**
 * Accountant utility for checking any GSTIN without associating it with a master record.
 * This uses the same field, modal, cache and explicit verification workflow as master forms.
 * The backend separately authorizes source-less operations for Accountants only.
 */
export function AccountantGstinLookup() {
  const [gstin, setGstin] = useState('');
  return (
    <Panel title="GSTIN verification">
      <GstinVerificationField
        label="GSTIN to verify"
        value={gstin}
        onChange={(event) => setGstin(event.target.value)}
        standalone
      />
    </Panel>
  );
}
