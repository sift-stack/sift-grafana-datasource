export function getFrontendHostname(apiBaseUrl: string): string | null {
  if (!apiBaseUrl) {
    return null;
  }

  const cleanUrl = apiBaseUrl.replace(/^https?:\/\//, '').trim();

  switch (cleanUrl) {
    case 'api.development.siftstack.com':
      return 'app.development.siftstack.com';
    case 'api.siftstack.com':
      return 'app.siftstack.com';
    case 'gov.api.siftstack.com':
      return 'gov.siftstack.com';
    default:
      return null;
  }
}
