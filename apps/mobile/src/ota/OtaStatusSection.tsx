import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@erve/primitives';
import { useOtaService, useOtaStatus } from './OtaProvider.js';

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "App updates" block for the Account sheet. Renders nothing outside the packaged app. */
export function OtaStatusSection() {
  const service = useOtaService();
  const status = useOtaStatus();
  const [busy, setBusy] = useState(false);

  if (!Capacitor.isNativePlatform()) return null;

  const checking = busy || status.phase === 'checking' || status.phase === 'downloading';
  return (
    <div className="mt-5 border-t border-border pt-4" data-testid="ota-status">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        App updates
      </div>
      <p className="text-sm text-foreground">
        Version:{' '}
        {status.currentVersion === 'embedded' ? 'Installed with the app' : status.currentVersion}
      </p>
      {status.native ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="ota-native-version">
          App installation {status.native.appVersion} (build {status.native.fingerprint.slice(0, 8)}
          )
        </p>
      ) : null}
      {status.channel === 'testing' ? (
        <p className="mt-1 text-xs font-medium text-foreground" data-testid="ota-test-channel">
          This app follows the test update channel.
        </p>
      ) : null}
      {status.enabled ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            {status.phase === 'downloading'
              ? 'Downloading an update…'
              : status.phase === 'checking'
                ? 'Checking for updates…'
                : status.lastCheck
                  ? `${status.lastCheck.message} (${formatTime(status.lastCheck.at)})`
                  : 'Not checked yet.'}
          </p>
          {status.newerApkAvailable && !status.nativeUpdateRequired ? (
            <p className="mt-1 text-xs text-muted-foreground">
              A newer app installation is available. Ask your administrator for the latest app file.
            </p>
          ) : null}
          <div className="mt-3">
            <Button
              variant="secondary"
              width="fill"
              disabled={checking}
              onClick={async () => {
                setBusy(true);
                try {
                  await service.checkForUpdate('manual');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Check for updates
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Automatic updates are not enabled in this build.
        </p>
      )}
    </div>
  );
}
