import type {
  ApiSuccessResponse,
  CartonDeliveryAcknowledgement,
  CartonDeliveryInput,
  PublicCartonDeliveryView,
} from '@erve/types';

// Deliberately independent of @erve/client: no cookies, login token, refresh or retry.
async function call<T>(operation: 'resolve' | 'confirm', token: string, body: object): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}/public/carton-delivery/${operation}`,
    {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', 'X-Carton-Delivery-Token': token },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    if (response.status === 429)
      throw new Error('Too many attempts. Please wait a minute and try again.');
    if (response.status === 409)
      throw new Error(
        'This carton cannot accept this submission. Scan it again to check its current state.',
      );
    if (response.status === 400)
      throw new Error('Check the delivery date, timezone and recipient name.');
    throw new Error('Carton delivery link is unavailable. Contact the dispatch team.');
  }
  return ((await response.json()) as ApiSuccessResponse<T>).data;
}
export const resolveCartonDelivery = (token: string) =>
  call<PublicCartonDeliveryView>('resolve', token, {});
export const confirmCartonDelivery = (token: string, input: CartonDeliveryInput) =>
  call<CartonDeliveryAcknowledgement>('confirm', token, input);
