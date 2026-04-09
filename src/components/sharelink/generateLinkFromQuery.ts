import type { SharelinkItems, SharelinkTimeRange } from '../../types';

function normalizeFrontendOrigin(hostname: string): string {
  if (!hostname) {
    throw new Error('hostname is required');
  }

  try {
    const parsedUrl = new URL(hostname);
    if (parsedUrl.origin && parsedUrl.origin !== 'null') {
      return parsedUrl.origin;
    }
    throw new Error('Invalid origin');
  } catch {
    const withProtocol = `https://${hostname}`;
    const parsedUrl = new URL(withProtocol);
    return parsedUrl.origin;
  }
}

function setCommaSeparatedParam(searchParams: URLSearchParams, key: string, values?: string[]) {
  if (values && values.length > 0) {
    searchParams.set(key, values.join(','));
  }
}

export function generateLinkFromQuery(
  hostname: string,
  items: SharelinkItems,
  timeRange?: SharelinkTimeRange
): string {
  const url = new URL('/explore', normalizeFrontendOrigin(hostname));
  const hasRuns = Boolean(items.runIds && items.runIds.length > 0);

  url.searchParams.set('method', 'single');
  url.searchParams.set('panelType', 'timeseries');

  if (!hasRuns) {
    setCommaSeparatedParam(url.searchParams, 'assetIds', items.assetIds);
  }
  setCommaSeparatedParam(url.searchParams, 'runIds', items.runIds);
  setCommaSeparatedParam(url.searchParams, 'channelIds', items.channelIds);

  if (timeRange?.from) {
    url.searchParams.set('startTime', timeRange.from);
  }

  if (timeRange?.to) {
    url.searchParams.set('endTime', timeRange.to);
  }

  return url.toString();
}
