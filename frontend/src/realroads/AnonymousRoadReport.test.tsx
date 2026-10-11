// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AnonymousRoadReport } from './AnonymousRoadReport';
import { realRoadApi } from './api';
import { roads } from './model';

vi.mock('./api', () => ({ realRoadApi: { publicUploadTicket: vi.fn(), upload: vi.fn(), publicCreate: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const road = roads.features[0];

function form() {
  render(<AnonymousRoadReport available roadId={road.id} point={road.geometry.coordinates[0]} roads={{ ...roads, metadata: { ...roads.metadata, geometryVersion: 'sha256:test' } }} />);
  fireEvent.change(screen.getByLabelText('Photo (JPEG, PNG or WebP; 8 MB max)'), { target: { files: [new File(['image'], 'road.png', { type: 'image/png' })] } });
  fireEvent.change(screen.getByLabelText('Optional observation note'), { target: { value: 'test note' } });
}

test('public form has no identity controls and preserves inputs on retryable failure', async () => {
  vi.mocked(realRoadApi.publicUploadTicket).mockRejectedValueOnce(new Error('Temporary upload failure'));
  form();
  expect(screen.queryByText(/sign in|create account|sign out/i)).toBeNull();
  expect(screen.getByText(/photograph remains private/)).toBeTruthy();
  fireEvent.submit(screen.getByRole('button', { name: 'Submit photo for review' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Temporary upload failure'));
  expect((screen.getByLabelText('Optional observation note') as HTMLInputElement).value).toBe('test note');
  expect((screen.getByLabelText('Photo (JPEG, PNG or WebP; 8 MB max)') as HTMLInputElement).files?.[0]?.name).toBe('road.png');
});

test('successful anonymous submission shows only a Pending Review receipt', async () => {
  vi.mocked(realRoadApi.publicUploadTicket).mockResolvedValue({ uploadUrl: 'https://example.test/upload', uploadFields: { key: 'uploads/real-road/anonymous/test' }, submissionToken: 'opaque', expiresAt: new Date(Date.now() + 60_000).toISOString(), maxBytes: 8388608 });
  vi.mocked(realRoadApi.upload).mockResolvedValue();
  vi.mocked(realRoadApi.publicCreate).mockResolvedValue({ id: `RR-${'a'.repeat(32)}`, reviewStatus: 'Pending Review' });
  form();
  fireEvent.submit(screen.getByRole('button', { name: 'Submit photo for review' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Pending Review'));
  expect(screen.getByRole('status').textContent).toContain('does not mark the road blocked');
  expect(screen.queryByText(/reviewer|photoUrl|ownerSub/)).toBeNull();
  expect(vi.mocked(realRoadApi.publicCreate).mock.calls[0][0].imageKey).toBe('uploads/real-road/anonymous/test');
});
