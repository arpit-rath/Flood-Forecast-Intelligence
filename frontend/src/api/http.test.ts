// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createHttpApi } from './http';

afterEach(() => vi.unstubAllGlobals());

test('protected upload request sends access token and multipart POST uses signed fields', async () => {
  const upload = { uploadUrl: 'https://s3.example.invalid/form', uploadFields: { key: 'uploads/one', 'Content-Type': 'image/png', policy: 'signed-policy' }, imageKey: 'uploads/one', expiresAt: '2030-01-01T00:00:00Z', maxBytes: 8 * 1024 * 1024 };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(upload), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const api = createHttpApi('https://api.example.invalid');
  api.setAccessToken('access-token');
  const issued = await api.requestUploadUrl({ contentType: 'image/png', sizeBytes: 4, idempotencyKey: 'abcdefghijklmnop' });
  const file = new File(['test'], 'road.png', { type: 'image/png' });
  await api.uploadImage(issued, file);
  const [, request] = fetch.mock.calls[0] as [string, RequestInit];
  expect((request.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  const [url, formRequest] = fetch.mock.calls[1] as [string, RequestInit];
  expect(url).toBe(upload.uploadUrl);
  expect(formRequest.method).toBe('POST');
  expect(formRequest.headers).toBeUndefined();
  const form = formRequest.body as FormData;
  expect(form.get('key')).toBe(upload.imageKey);
  expect(form.get('policy')).toBe('signed-policy');
  expect((form.get('file') as File).name).toBe('road.png');
});
