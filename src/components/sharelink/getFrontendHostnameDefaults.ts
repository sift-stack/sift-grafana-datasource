

// The sift frontend can be hosted on multiple domains, and there's no dynamic way to get the correct hostname from the backend api
// Edit this file to test the sharelink against other endpoints. This is needed for on prem deployments
export function getFrontendHostnameDefaults(apiBaseUrl: string): string | null {
  if (!apiBaseUrl) {
    return null;
  }

  // Use URL constructor to properly parse the URL and extract the host
  let cleanUrl: string;
  try {
    const url = new URL(apiBaseUrl);
    cleanUrl = url.host; // host includes port if present
  } catch {
    // If not a valid URL, assume it's already a hostname and use as-is
    cleanUrl = apiBaseUrl.trim();
  }

  switch (cleanUrl) {
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
