import { describe, expect, it } from 'vitest';
import { delhiHybridStyleUrl, delhiStandardStyleUrl, delhiStyleUrls } from './delhiStyle';

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

describe('Delhi Standard and Hybrid style URLs', () => {
  it('derives Standard from the existing restricted Hybrid URL and keeps the public key query', () => {
    expect(delhiStyleUrls(undefined, 'https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor?key=example'))
      .toEqual({
        Standard: 'https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor?key=example',
        Hybrid: 'https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor?key=example',
      });
  });

  it('accepts only the exact AWS Standard descriptor and fails closed without a valid style', () => {
    expect(delhiStandardStyleUrl('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor'))
      .toBe('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor');
    expect(delhiStandardStyleUrl('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Hybrid/descriptor')).toBeNull();
    expect(delhiStyleUrls('https://evil.example/descriptor', undefined)).toBeNull();
  });
});
