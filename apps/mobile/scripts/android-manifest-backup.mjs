/**
 * Points the generated AndroidManifest.xml's <application> at the backup rules in
 * native/android-template/res/xml, so sign-in material is never backed up or transferred.
 * Idempotent: running it again changes nothing.
 */
const ATTRIBUTES = {
  'android:fullBackupContent': '@xml/erve_backup_rules',
  'android:dataExtractionRules': '@xml/erve_data_extraction_rules',
};

export function patchManifestBackupRules(manifest) {
  const match = /<application\b[^>]*>/.exec(manifest);
  if (!match) throw new Error('AndroidManifest.xml has no <application> element.');
  let tag = match[0];
  for (const [name, value] of Object.entries(ATTRIBUTES)) {
    const existing = new RegExp(String.raw`\s${name}="[^"]*"`);
    tag = existing.test(tag)
      ? tag.replace(existing, ` ${name}="${value}"`)
      : tag.replace('<application', `<application\n        ${name}="${value}"`);
  }
  return manifest.replace(match[0], tag);
}
