import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_REAL_ROADS_PREVIEW !== 'true', 'Real-road preview only');

test('mock preview labels unavailable source alerts without network fallback', async ({ page }) => {
  test.skip(process.env.VITE_USE_MOCKS === 'false', 'Fixture/mock mode only');
  const alertRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/v2/road-alerts')) alertRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Delhi Traffic Police source alerts' })).toBeVisible();
  await expect(page.getByText('Road-alert API is not part of fixture/mock mode. No source alerts are shown.')).toBeVisible();
  if (process.env.VITE_OPERATOR_CONSOLE_ENABLED === 'true') {
    await page.getByRole('link', { name: 'Responder', exact: true }).click();
    await expect(page.getByText(/Only signed-in varuna-responder members may import/)).toBeVisible();
  } else await expect(page.getByRole('link', { name: 'Responder', exact: true })).toHaveCount(0);
  expect(alertRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('HTTP preview keeps imported source unverified and review responder-only', async ({ page, request }) => {
  test.skip(process.env.VITE_USE_MOCKS !== 'false' || process.env.VITE_OPERATOR_CONSOLE_ENABLED !== 'true', 'Local operator API mode only');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Delhi Traffic Police source alerts' })).toBeVisible();
  const api = 'http://127.0.0.1:8000';
  const residentAuth = await request.post(`${api}/v1/auth/local-session`, { data: { username: 'resident', password: 'throwaway-resident-test' } });
  const residentToken = (await residentAuth.json()).accessToken;
  const now = new Date().toISOString();
  const sourceDocument = {
    canonicalSourceUrl: 'https://traffic.delhipolice.gov.in/en', advisoryUrl: `https://example.org/test-${Date.now()}`,
    sourceType: 'traffic_alert', publishedAtText: now, retrievedAt: now,
    originalHeadline: `Test fixture source alert ${Date.now()}`, originalText: 'Test-only waterlogging source wording for automated local verification.',
    statedCause: 'waterlogging', affectedLocation: 'unlocated test area', sourceAvailability: 'available',
    sourceError: 'responder-only test note', locationHints: { roadNames: ['way outside extract'] },
  };
  expect((await request.post(`${api}/v2/road-alerts/import`, { data: sourceDocument })).status()).toBe(403);
  expect((await request.post(`${api}/v2/road-alerts/import`, { data: sourceDocument, headers: { Authorization: `Bearer ${residentToken}` } })).status()).toBe(403);
  expect((await request.get(`${api}/v2/road-alerts/review`, { headers: { Authorization: `Bearer ${residentToken}` } })).status()).toBe(403);
  await page.getByRole('link', { name: 'Responder', exact: true }).click();
  await page.getByLabel('Demo account').fill('responder');
  await page.getByLabel('Password').fill('throwaway-responder-test');
  await page.getByRole('button', { name: 'Sign in to local demo' }).click();
  await expect(page.getByText(/Responder review access/)).toBeVisible();
  await page.getByLabel('Normalized source-document JSON').fill(JSON.stringify(sourceDocument));
  await page.getByRole('button', { name: 'Import source for review' }).click();
  const publicList = page.getByRole('list', { name: 'Public source alerts' });
  const publicItem = publicList.locator(':scope > li').filter({ hasText: sourceDocument.originalHeadline });
  await expect(publicItem).toContainText(sourceDocument.originalHeadline);
  await expect(publicItem).toContainText('Reported / Unverified');
  await expect(publicItem).toContainText('This public feed does not identify a reviewed road');
  await expect(publicItem).toContainText('Location resolution: unlocated. No road condition inferred.');
  await expect(publicList).not.toContainText('responder-only test note');
  await expect(page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first()).toContainText('Unknown');
  const privateList = page.getByRole('list', { name: 'Private source review queue' });
  const privateItem = privateList.locator(':scope > li').filter({ hasText: sourceDocument.originalHeadline });
  await expect(privateItem).toContainText('responder-only test note');
  await expect(privateItem).toContainText('Unlocated in this extract');
  await page.getByLabel('Review reason (at least 10 characters)').fill('No verifiable road match in extract');
  await privateItem.getByRole('button', { name: 'Reject alert' }).click();
  await expect(publicItem).toContainText('Rejected');
  const publicResponse = await request.get(`${api}/v2/road-alerts`);
  expect(publicResponse.ok()).toBe(true);
  const imported = (await publicResponse.json()).alerts.find((alert: { originalHeadline: string }) => alert.originalHeadline === sourceDocument.originalHeadline);
  for (const field of ['sourceError', 'reviewHistory', 'candidateRoads', 'reviewerSub', 'originalText']) expect(imported).not.toHaveProperty(field);
  const landmarkDocument = { ...sourceDocument,
    advisoryUrl: `https://example.org/landmark-${Date.now()}-${Math.random()}`,
    originalHeadline: `DTU boundary test fixture ${Date.now()}`,
    affectedLocation: 'Delhi Technological University, Shahbad Daulatpur',
    locationHints: { landmarks: ['Delhi Technological University'], localities: ['Shahbad Daulatpur'] },
  };
  await page.getByLabel('Normalized source-document JSON').fill(JSON.stringify(landmarkDocument));
  await page.getByRole('button', { name: 'Import source for review' }).click();
  const landmarkPublic = publicList.locator(':scope > li').filter({ hasText: landmarkDocument.originalHeadline });
  await expect(landmarkPublic).toContainText('Proposed match: Unnamed road near Delhi Technological University campus boundary');
  await expect(landmarkPublic).toContainText('Not a confirmed blockage');
  const landmarkPrivate = privateList.locator(':scope > li').filter({ hasText: landmarkDocument.originalHeadline });
  await expect(landmarkPrivate).toContainText('landmark locality');
  await landmarkPrivate.getByRole('button', { name: 'Select this candidate on map' }).click();
  await expect(page.getByRole('list', { name: 'Mapped roads' }).getByRole('button', { pressed: true })).toContainText('Unknown');
  await expect(landmarkPrivate.getByRole('button', { name: 'Confirm flood blockage on selected candidate' })).toBeDisabled();
  const responseWithProposal = await request.get(`${api}/v2/road-alerts`);
  const proposed = (await responseWithProposal.json()).alerts.find((alert: { originalHeadline: string }) => alert.originalHeadline === landmarkDocument.originalHeadline);
  expect(proposed.resolutionState).toBe('matched_candidate');
  expect(proposed.proposal).toMatchObject({ method: 'landmark_locality', confidenceCategory: 'low' });
  expect(proposed.proposal).not.toHaveProperty('roadId');
  for (const field of ['sourceError', 'reviewHistory', 'candidateRoads', 'reviewerSub', 'originalText']) expect(proposed).not.toHaveProperty(field);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
