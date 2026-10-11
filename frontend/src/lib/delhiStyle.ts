/** Only the Amazon Location Hybrid descriptor is accepted for the citywide basemap. */
export function delhiHybridStyleUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'https:' ||
      !/^maps\.geo\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) ||
      url.pathname !== '/v2/styles/Hybrid/descriptor' ||
      url.username || url.password || url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
