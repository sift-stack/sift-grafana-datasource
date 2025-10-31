

// The sift frontend can be hosted on multiple domains, and there's no dynamic way to get the correct hostname from the backend api
// Edit this file to test the sharelink against other endpoints. This is needed for on prem deployments
export function getFrontendHostnameDefaults(apiBaseUrl: string): string | null {
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
    case 'localhost:8080':
      return 'http://localhost:3000';
    case 'host.docker.internal:8080':
      return 'http://localhost:3000';
    default:
      return null;
  }
}
