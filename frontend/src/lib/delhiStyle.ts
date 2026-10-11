type AmazonMapStyle = 'Standard' | 'Hybrid';

/** Browser-public Amazon Location descriptors, never arbitrary tile endpoints. */
function validatedStyleUrl(raw: string | undefined, style: AmazonMapStyle): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'https:' ||
      !/^maps\.geo\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) ||
      url.pathname !== `/v2/styles/${style}/descriptor` ||
      url.username || url.password || url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function delhiHybridStyleUrl(raw: string | undefined): string | null {
  return validatedStyleUrl(raw, 'Hybrid');
}

export function delhiStandardStyleUrl(raw: string | undefined): string | null {
  return validatedStyleUrl(raw, 'Standard');
}

export function delhiStyleUrls(standardRaw: string | undefined, hybridRaw: string | undefined): { Standard: string; Hybrid: string } | null {
  const standard = delhiStandardStyleUrl(standardRaw);
  const hybrid = delhiHybridStyleUrl(hybridRaw);
  if (!standard && !hybrid) return null;
  const from = new URL((standard ?? hybrid)!);
  const make = (style: AmazonMapStyle) => {
    const url = new URL(from);
    url.pathname = `/v2/styles/${style}/descriptor`;
    return url.toString();
  };
  return { Standard: standard ?? make('Standard'), Hybrid: hybrid ?? make('Hybrid') };
}
