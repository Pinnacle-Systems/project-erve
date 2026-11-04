// Reads a fetch Response as JSON without ever buffering more than `maxBytes`,
// including chunked responses that carry no Content-Length. Kept separate from
// the existing GST providers (which inline the same loop) so they are untouched.

export type BoundedBodyFailure = 'TOO_LARGE' | 'EMPTY_BODY' | 'MALFORMED_JSON';

export class BoundedBodyError extends Error {
  constructor(public readonly reason: BoundedBodyFailure) {
    super('Response body could not be read');
  }
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new BoundedBodyError('EMPTY_BODY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BoundedBodyError('TOO_LARGE');
    }
    chunks.push(chunk.value);
  }
  if (size === 0) throw new BoundedBodyError('EMPTY_BODY');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BoundedBodyError('MALFORMED_JSON');
  }
}
