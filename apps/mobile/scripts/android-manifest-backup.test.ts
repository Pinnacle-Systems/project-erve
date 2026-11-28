import { describe, expect, it } from 'vitest';
import { patchManifestBackupRules } from './android-manifest-backup.mjs';

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher">
        <activity android:name=".MainActivity" />
    </application>
</manifest>`;

describe('patchManifestBackupRules', () => {
  it('adds both backup rule references to <application>', () => {
    const patched = patchManifestBackupRules(MANIFEST);
    expect(patched).toContain('android:fullBackupContent="@xml/erve_backup_rules"');
    expect(patched).toContain('android:dataExtractionRules="@xml/erve_data_extraction_rules"');
    expect(patched).toContain('android:allowBackup="true"');
    expect(patched).toContain('<activity android:name=".MainActivity" />');
  });

  it('is idempotent', () => {
    const once = patchManifestBackupRules(MANIFEST);
    expect(patchManifestBackupRules(once)).toBe(once);
  });

  it('replaces different existing values instead of duplicating them', () => {
    const custom = MANIFEST.replace(
      '<application',
      '<application android:fullBackupContent="@xml/other"',
    );
    const patched = patchManifestBackupRules(custom);
    expect(patched.match(/android:fullBackupContent=/g)).toHaveLength(1);
    expect(patched).toContain('android:fullBackupContent="@xml/erve_backup_rules"');
  });

  it('fails clearly when the manifest has no application element', () => {
    expect(() => patchManifestBackupRules('<manifest/>')).toThrow(/no <application>/);
  });
});
