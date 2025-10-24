import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharelinkMenuItem } from './SharelinkMenuItem';
import { createExplorerLink } from './createExplorerLink';
import { getFrontendHostname } from './getFrontendHostname';
import { getAppEvents } from '@grafana/runtime';

jest.mock('./createExplorerLink', () => ({
  createExplorerLink: jest.fn(),
}));

jest.mock('./getFrontendHostname', () => ({
  getFrontendHostname: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(),
}));

const createExplorerLinkMock = createExplorerLink as jest.MockedFunction<typeof createExplorerLink>;
const getFrontendHostnameMock = getFrontendHostname as jest.MockedFunction<typeof getFrontendHostname>;
const getAppEventsMock = getAppEvents as jest.MockedFunction<typeof getAppEvents>;

describe('SharelinkMenuItem', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    createExplorerLinkMock.mockReturnValue('https://sift.example.com/explorer');
    getFrontendHostnameMock.mockReturnValue('sift.example.com');
    getAppEventsMock.mockReturnValue(null as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('creates explorer link with legend entries for all channels', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const items = {
      channelIds: ['channel-1', 'channel-2', 'channel-3'],
      assetIds: ['asset-1', 'asset-2'],
      runIds: ['run-1', 'run-2'],
      calculatedChannels: [],
    };

    render(<SharelinkMenuItem items={items} apiBaseUrl="https://api.sift.dev" />);

    expect(createExplorerLinkMock).toHaveBeenCalledTimes(1);
    const payload = createExplorerLinkMock.mock.calls[0][0];

    expect(payload.origin).toBe('https://sift.example.com');
    expect(payload.assets).toEqual(['asset-1', 'asset-2']);
    expect(payload.runs).toEqual(['run-1', 'run-2']);

    const legend = payload.legend!;
    expect(legend.axes['y-axis-1']).toEqual(['channel-key-1', 'channel-key-2', 'channel-key-3']);
    expect(legend.axes['x-axis-1']).toEqual(['channel-key-1', 'channel-key-2', 'channel-key-3']);
    expect(Object.keys(legend.channels)).toEqual(['channel-key-1', 'channel-key-2', 'channel-key-3']);
    expect(legend.channels['channel-key-1']).toMatchObject({ channelId: 'channel-1', visible: true, showTooltip: true });
    expect(legend.channels['channel-key-2']).toMatchObject({ channelId: 'channel-2', visible: true, showTooltip: true });
    expect(legend.channels['channel-key-3']).toMatchObject({ channelId: 'channel-3', visible: true, showTooltip: true });

    const button = screen.getByRole('button', { name: 'Open in Sift' });
    fireEvent.click(button);

    expect(openSpy).toHaveBeenCalledWith('https://sift.example.com/explorer', '_blank');
    openSpy.mockRestore();
  });

  it('disables share actions when API base URL is not configured', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const items = { channelIds: ['channel-1'], assetIds: ['asset-1'], runIds: ['run-1'], calculatedChannels: [] };

    render(<SharelinkMenuItem items={items} apiBaseUrl={undefined} />);

    expect(createExplorerLinkMock).not.toHaveBeenCalled();

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
});
