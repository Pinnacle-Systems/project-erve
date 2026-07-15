export interface HealthCheckResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadyCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
}
