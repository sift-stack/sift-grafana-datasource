import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenInSiftButton } from './OpenInSiftButton';
import { generateLinkFromQuery } from './generateLinkFromQuery';
import { getFrontendHostnameDefaults } from './getFrontendHostnameDefaults';
import { getAppEvents } from '@grafana/runtime';

jest.mock('./generateLinkFromQuery', () => ({
  generateLinkFromQuery: jest.fn(),
}));

jest.mock('./getFrontendHostnameDefaults', () => ({
  getFrontendHostname: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(),
}));

const generateLinkFromQueryMock = generateLinkFromQuery as jest.MockedFunction<typeof generateLinkFromQuery>;
const getFrontendHostnameMock = getFrontendHostnameDefaults as jest.MockedFunction<typeof getFrontendHostnameDefaults>;
const getAppEventsMock = getAppEvents as jest.MockedFunction<typeof getAppEvents>;

describe('OpenInSiftButton', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    generateLinkFromQueryMock.mockReturnValue('https://sift.example.com/explorer');
    getFrontendHostnameMock.mockReturnValue('sift.example.com');
    getAppEventsMock.mockReturnValue(null as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('generates link with channel items', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const items = {
      channelIds: ['channel-1', 'channel-2', 'channel-3'],
      assetIds: ['asset-1', 'asset-2'],
      runIds: ['run-1', 'run-2'],
      calculatedChannels: [],
    };

    render(<OpenInSiftButton items={items} apiBaseUrl="https://api.sift.dev" />);

    expect(generateLinkFromQueryMock).toHaveBeenCalledTimes(1);
    expect(generateLinkFromQueryMock).toHaveBeenCalledWith(
      'sift.example.com',
      items,
      undefined
    );

    const button = screen.getByRole('button', { name: 'Open in Sift' });
    fireEvent.click(button);

    expect(openSpy).toHaveBeenCalledWith('https://sift.example.com/explorer', '_blank');
    openSpy.mockRestore();
  });

  it('disables share actions when API base URL is not configured', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const items = { channelIds: ['channel-1'], assetIds: ['asset-1'], runIds: ['run-1'], calculatedChannels: [] };

    render(<OpenInSiftButton items={items} apiBaseUrl={undefined} />);

    expect(generateLinkFromQueryMock).not.toHaveBeenCalled();

    expect(openSpy).not.toHaveBeenCalled();

    const menuButton = screen.getByRole('button', { name: 'Open in Sift' });
    fireEvent.contextMenu(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Open Link/i })).toBeDisabled();
    });

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Copy \(URL not set\)/i })).toBeDisabled();
    });

    openSpy.mockRestore();
  });

  it('passes timeRange to generateLinkFromQuery when provided', () => {
    const items = {
      channelIds: ['channel-1'],
      assetIds: ['asset-1'],
      runIds: ['run-1'],
      calculatedChannels: [],
    };

    const timeRange = {
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
    };

    render(<OpenInSiftButton items={items} apiBaseUrl="https://api.sift.dev" timeRange={timeRange} />);

    expect(generateLinkFromQueryMock).toHaveBeenCalledWith(
      'sift.example.com',
      items,
      timeRange
    );
  });

  it('passes undefined timeRange when not provided', () => {
    const items = {
      channelIds: ['channel-1'],
      assetIds: ['asset-1'],
      runIds: ['run-1'],
      calculatedChannels: [],
    };

    render(<OpenInSiftButton items={items} apiBaseUrl="https://api.sift.dev" />);

    expect(generateLinkFromQueryMock).toHaveBeenCalledWith(
      'sift.example.com',
      items,
      undefined
    );
  });

  it('disables share link when no channels are selected', async () => {
    const items = {
      channelIds: [],
      assetIds: ['asset-1'],
      runIds: ['run-1'],
      calculatedChannels: [],
    };

    render(<OpenInSiftButton items={items} apiBaseUrl="https://api.sift.dev" />);

    expect(generateLinkFromQueryMock).not.toHaveBeenCalled();

    const menuButton = screen.getByRole('button', { name: 'Open in Sift' });
    fireEvent.contextMenu(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Open Link/i })).toBeDisabled();
    });
  });
});
