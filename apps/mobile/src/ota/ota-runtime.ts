import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { apiClient } from '../lib/api-client.js';
import { inFlightWrites } from './inflight-writes.js';
import { otaBuildConfig } from './ota-config.js';
import { OtaStateStore, type KeyValueStorage } from './ota-state-store.js';
import { OtaUpdateService } from './ota-service.js';
import { capgoUpdaterPort } from './updater-port.js';
import { UpdateGuardRegistry, protectedRouteReason } from './update-guards.js';

/** Process-wide singletons: one guard registry and one service per WebView. */
export const otaGuards = new UpdateGuardRegistry();

// Registered at module load so it is already in force when the startup
// activation decision is made: a WebView reload that lands on an open QA
// inspection / production screen must not be bounced into a new bundle either.
// (Under BrowserRouter, location.pathname is always the live route.)
otaGuards.register(() =>
  typeof window === 'undefined' ? null : protectedRouteReason(window.location.pathname),
);

// Every API write on the wire — including direct apiClient calls such as QA
// evidence/attachment uploads that never pass through useMutation — holds updates.
inFlightWrites.install(apiClient);
otaGuards.register(() => inFlightWrites.blockingReason());
inFlightWrites.subscribe(() => otaGuards.notify());

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const otaService = new OtaUpdateService({
  config: otaBuildConfig,
  updater: capgoUpdaterPort,
  httpGetJson: async (url, { timeoutMs }) => {
    const response = await CapacitorHttp.get({
      url,
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType: 'json',
    });
    return { status: response.status, data: response.data as unknown };
  },
  store: new OtaStateStore(safeLocalStorage()),
  guards: otaGuards,
  isNative: Capacitor.getPlatform() === 'android',
  log: (message, detail) => console.warn(`[ota] ${message}`, detail ?? ''),
});
