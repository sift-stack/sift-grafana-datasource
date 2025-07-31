import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryEditor } from './QueryEditor';
import { useFetchAssets, useFetchRuns, useFetchChannels, useSiftAssetVariables } from '../../resources.hooks';
import { QueryTypes } from '../../types';

jest.mock('../../resources.hooks', () => ({
  useFetchChannels: jest.fn(),
  useFetchAssets: jest.fn(),
  useFetchRuns: jest.fn(),
  useSiftAssetVariables: jest.fn(),
}));

jest.mock('nanoid', () => ({
  nanoid: () => `mocked-id-${Math.floor(Math.random() * 1000)}`,
}));

function createMockSiftDataSource() {
  return {
    id: 1,
    name: 'Test DS',
    getResource: jest.fn(),
    getDefaultQuery: jest.fn(),
    migrateQuery: jest.fn(),
    applyTemplateVariables: jest.fn(),
    query: jest.fn(),
    getRequestHeaders: jest.fn(),
    interpolateVariablesInQueries: jest.fn(),
    streamOptionsProvider: jest.fn(),
    postResource: jest.fn(),
  } as any;
}

describe('QueryConfig', () => {
  const defaultProps = {
    datasource: createMockSiftDataSource(),
    queryType: QueryTypes.CHANNEL,
    channelDataQueries: [],
    onUpdateChannelDataQueries: jest.fn(),
    onRefreshCache: jest.fn(),
  };

  beforeEach(() => {
    (useFetchChannels as jest.Mock).mockReturnValue({
      channels: [
        { channelId: 'ch1', name: 'Channel 1' },
        { channelId: 'ch2', name: 'Channel 2' },
        { channelId: 'ch3', name: 'Channel 3' },
      ],
      loading: false,
      loadChannels: jest.fn(),
    });
    (useFetchAssets as jest.Mock).mockReturnValue({
      assets: [
        { assetId: 'a1', name: 'Asset 1' },
        { assetId: 'a2', name: 'Asset 2' },
      ],
      loading: false,
      loadAssets: jest.fn(),
    });
    (useFetchRuns as jest.Mock).mockReturnValue({
      runs: [
        { runId: 'r1', name: 'Run 1' },
        { runId: 'r2', name: 'Run 2' },
      ],
      loading: false,
      loadRuns: jest.fn(),
    });
    jest.clearAllMocks();
  });

  it('renders appropriate items for a single SubQuery group', async () => {
    render(<QueryEditor {...defaultProps} />);
    expect(screen.getByText(/select/i, { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText(/asset/i, { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText(/run/i, { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText(/channel/i, { selector: 'label' })).toBeInTheDocument();
    const comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBeGreaterThanOrEqual(3);
  });

  it('inserts a new SubQuery group', async () => {
    render(<QueryEditor {...defaultProps} />);
    const addButton = screen.getByRole('button', { name: /insert asset/i });
    await userEvent.click(addButton);
    expect(defaultProps.onUpdateChannelDataQueries).toHaveBeenCalled();
  });

  it('inserts a new SubQuery group in middle', async () => {
    const multiProps = {
      ...defaultProps,
      channelDataQueries: [
        { assetQueries: [], runQueries: [], channelQueries: [] },
        { assetQueries: [], runQueries: [], channelQueries: [] },
      ],
    };
    render(<QueryEditor {...multiProps} />);
    const addButtons = screen.getAllByRole('button', { name: /insert asset/i });
    await userEvent.click(addButtons[1]);
    expect(defaultProps.onUpdateChannelDataQueries).toHaveBeenCalledWith([
      expect.objectContaining({
        assetQueries: [{ asSelect: true }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ asSelect: true }],
      }),
      expect.objectContaining({
        assetQueries: [{ asSelect: true }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ asSelect: true }],
      }),
      expect.objectContaining({
        assetQueries: [{ asSelect: true }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ asSelect: true }],
      }),
    ]);
  });

  it('clones an SubQuery group', async () => {
    const multiProps = {
      ...defaultProps,
      channelDataQueries: [
        { assetQueries: [{ assetId: 'asset1' }], runQueries: [], channelQueries: [{ channelId: 'channel1' }] },
        { assetQueries: [{ assetId: 'asset2' }], runQueries: [{ runId: 'run1' }], channelQueries: [] },
      ],
    };
    render(<QueryEditor {...multiProps} />);
    const cloneButton = screen.getAllByRole('button', { name: /clone asset/i });
    await userEvent.click(cloneButton[0]);
    expect(defaultProps.onUpdateChannelDataQueries).toHaveBeenCalledWith([
      expect.objectContaining({
        assetQueries: [{ assetId: 'asset1' }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ channelId: 'channel1' }],
      }),
      expect.objectContaining({
        assetQueries: [{ assetId: 'asset2' }],
        runQueries: [{ runId: 'run1' }],
        channelQueries: [{ asSelect: true }],
      }),
      expect.objectContaining({
        assetQueries: [{ assetId: 'asset1' }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ channelId: 'channel1' }],
      }),
    ]);
  });

  it('removes an SubQuery group', async () => {
    const multiProps = {
      ...defaultProps,
      query: {
        assetRunQueries: [
          { assetQueries: [], runQueries: [], channelQueries: [] },
          { assetQueries: [], runQueries: [], channelQueries: [] },
        ],
      },
    };
    render(<QueryEditor {...multiProps} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove asset/i });
    await userEvent.click(removeButtons[1]);
    expect(defaultProps.onUpdateChannelDataQueries).toHaveBeenCalledWith([
      {
        assetQueries: [{ asSelect: true }],
        runQueries: [{ asSelect: true }],
        channelQueries: [{ asSelect: true }],
      },
    ]);
  });

  it('renders correct inputs for pre-defined channel data query', async () => {
    const props = {
      ...defaultProps,
      channelDataQueries: [
        {
          assetQueries: [],
          runQueries: [],
          channelQueries: [
            { channelName: 'Channel 1', asSelect: true },
            { channelName: 'RegexChannel', nameAsRegex: true },
            { channelId: 'ch4' },
            { channelName: 'SomeChannel' },
            { asSelect: true },
          ],
        },
      ],
    };
    render(<QueryEditor {...props} />);
    const removeChannelButtons = screen.getAllByRole('button', { name: /remove channel/i });
    expect(removeChannelButtons.length).toBe(5);
    const comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Channel 1')).toBeInTheDocument();
    expect(screen.getByText(/select a channel/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('RegexChannel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ch4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SomeChannel')).toBeInTheDocument();
  });
});
