import { describe, expect, it } from 'vitest';
import { delhiHybridStyleUrl } from './delhiStyle';

describe('Delhi Hybrid style URL', () => {
  it('accepts only the Amazon Location Hybrid descriptor', () => {
    expect(delhiHybridStyleUrl('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor'))
      .toBe('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor');
  });

  it.each([
    undefined,
    '',
    'http://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor',
    'https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor',
    'https://maps.geo.ap-south-1.amazonaws.com.evil.test/v2/styles/Hybrid/descriptor',
    'https://example.com/v2/styles/Hybrid/descriptor',
  ])('rejects unconfigured or unrelated styles: %s', (url) => {
    expect(delhiHybridStyleUrl(url)).toBeNull();
  });
});
