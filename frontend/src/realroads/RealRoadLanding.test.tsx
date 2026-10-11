// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { RealRoadLanding } from './RealRoadLanding';

afterEach(cleanup);

test('public landing describes the limited reviewed-evidence workflow without account or pilot claims', () => {
  render(<RealRoadLanding />);
  expect(screen.getByRole('heading', { level: 1, name: /Know what is reported/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Open Delhi road map/ }).getAttribute('href')).toBe('#/resident');
  expect(screen.getByText(/84 OpenStreetMap ways near DTU/)).toBeTruthy();
  expect(screen.getByText(/Unknown is not Low or Clear/)).toBeTruthy();
  expect(screen.getByText(/Reported \/ Unverified until reviewed/)).toBeTruthy();
  expect(screen.getByText(/Follow police directions, barricades, emergency services/)).toBeTruthy();
  expect(screen.queryByText(/sign in|sign up|create account|your reports|responder console|Scenario rainfall|drain simulation|route comparison/i)).toBeNull();
});
