// Mock useFetchChannels before any imports that use it
jest.mock('../../resources.hooks', () => ({
  useFetchChannels: jest.fn(),
}));

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ChannelQueryEditor } from './ChannelQueryEditor';
import { useFetchChannels } from '../../resources.hooks';
import userEvent from '@testing-library/user-event';
import { ChannelQuery, Channel, QueryTypes } from '../../types';

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

describe('ChannelQueryEditor', () => {
  const defaultProps = {
    datasource: createMockSiftDataSource(),
    queryType: QueryTypes.CHANNEL,
    channelIndex: 0,
    channelQueryId: 'test-id',
    channelQuery: { asSelect: true },
    onUpdateQuery: jest.fn(),
    addQuery: jest.fn(),
    removeQuery: jest.fn(),
    canRemove: true,
    selectedAssetIds: ['asset-1'],
    selectEnabled: true,
  };

  beforeEach(() => {
    (useFetchChannels as jest.Mock).mockReturnValue({
      channels: [{ channelId: 'ch1', name: 'Channel 1' } as Channel],
      loading: false,
      loadChannels: jest.fn(),
    });
    jest.clearAllMocks();
  });

  it('renders CHANNEL label, Select, remove button, and add button', async () => {
    render(<ChannelQueryEditor {...defaultProps} />);
    // Check for uppercase CHANNEL label
    expect(screen.getByText('CHANNEL')).toBeInTheDocument();

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/select a channel/i)).toBeInTheDocument();

    const changeInputTypeButton = screen.getByRole('button', { name: /Change input type/i });
    expect(changeInputTypeButton).toBeInTheDocument();

    const removeButton = screen.getByTestId(/times/i).parentElement;
    expect(removeButton).toBeInTheDocument();

    const addButton = screen.getByTestId(/plus/i).parentElement;
    expect(addButton).toBeInTheDocument();
  });

  it('renders as calculated channel', async () => {
    render(<ChannelQueryEditor {...defaultProps} queryType={QueryTypes.CALCULATED_CHANNEL} />);
    // Check for uppercase CHANNEL label
    expect(screen.getByText('CHANNEL')).toBeInTheDocument();
    expect(screen.getByText('$1')).toBeInTheDocument();

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/select a channel/i)).toBeInTheDocument();

    const changeInputTypeButton = screen.getByRole('button', { name: /Change input type/i });
    expect(changeInputTypeButton).toBeInTheDocument();

    const removeButton = screen.getByTestId(/times/i).parentElement;
    expect(removeButton).toBeInTheDocument();

    const addButton = screen.getByTestId(/plus/i).parentElement;
    expect(addButton).toBeInTheDocument();
  });

  it('calls addQuery when remove button is clicked', async () => {
    render(<ChannelQueryEditor {...defaultProps} />);
    const addButton = screen.getByTestId(/plus/i).parentElement;
    expect(addButton).toBeInTheDocument();
    await userEvent.click(addButton!);
    expect(defaultProps.addQuery).toHaveBeenCalledWith('test-id');
  });

  it('calls removeQuery when remove button is clicked', async () => {
    render(<ChannelQueryEditor {...defaultProps} />);
    const removeButton = screen.getByTestId(/times/i).parentElement;
    expect(removeButton).toBeInTheDocument();
    await userEvent.click(removeButton!);
    expect(defaultProps.removeQuery).toHaveBeenCalledWith('test-id');
  });

  it('disables remove button if canRemove is false', async () => {
    render(<ChannelQueryEditor {...defaultProps} canRemove={false} />);
    const removeButton = screen.getByTestId(/times/i).parentElement;
    expect(removeButton).toBeInTheDocument();
    await userEvent.click(removeButton!);
    expect(defaultProps.removeQuery).not.toHaveBeenCalled();
  });

  it('renders with provided channelQueryIndex', () => {
    render(<ChannelQueryEditor {...defaultProps} queryType={QueryTypes.CALCULATED_CHANNEL} channelIndex={2} />);
    expect(screen.getByText('$3')).toBeInTheDocument();
  });

  it('renders loading state when channels are loading', () => {
    (useFetchChannels as jest.Mock).mockReturnValue({
      channels: [],
      loading: true,
      loadChannels: jest.fn(),
    });
    render(<ChannelQueryEditor {...defaultProps} />);
    expect(screen.getByTestId('Spinner')).toBeInTheDocument();
  });

  it('renders empty state when no channels are returned', async () => {
    (useFetchChannels as jest.Mock).mockReturnValue({
      channels: [],
      loading: false,
      loadChannels: jest.fn(),
    });
    render(<ChannelQueryEditor {...defaultProps} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    await userEvent.click(select);
    expect(screen.getByText(/no channels found/i)).toBeInTheDocument();
  });

  it('does not render CHANNEL label if channelIndex is not zero', () => {
    render(<ChannelQueryEditor {...defaultProps} channelIndex={1} />);
    expect(screen.queryByText('CHANNEL')).not.toBeInTheDocument();
  });

  it('calls onUpdateQuery when a selection is made and passes correct data', async () => {
    render(<ChannelQueryEditor {...defaultProps} />);
    const select = screen.getByRole('combobox');
    await userEvent.click(select);
    // Simulate selecting a channel option
    const option = screen.getByText(/channel 1/i);
    await userEvent.click(option);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledTimes(1);
    const [calledQuery, calledId] = defaultProps.onUpdateQuery.mock.calls[0];
    expect(calledId).toBe('test-id');
    expect(calledQuery).toMatchObject({
      channelId: 'ch1',
      channelName: 'Channel 1',
      asSelect: true,
    });
  });

  it('calls onUpdateQuery when text is entered and passes correct data', async () => {
    render(<ChannelQueryEditor {...defaultProps} />);
    // Switch to text input mode
    const changeTypeButton = screen.getByRole('button', { name: /change input type/i });

    // Text
    await userEvent.click(changeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    const textbox = screen.getByRole('textbox');
    await userEvent.type(textbox, 'my custom text');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith({ channelName: 'my custom text' }, 'test-id');

    // ID
    await userEvent.click(changeTypeButton);
    const idMenuItem = screen.getByRole('menuitem', { name: /id/i });
    await userEvent.click(idMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith({ channelId: 'my custom text' }, 'test-id'); // the previous textbox value is kept
    await userEvent.clear(textbox);
    await userEvent.type(textbox, 'some-awesome-id');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith({ channelId: 'some-awesome-id' }, 'test-id');

    // Regex
    await userEvent.click(changeTypeButton);
    const regexMenuItem = screen.getByRole('menuitem', { name: /regex/i });
    await userEvent.click(regexMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { channelName: 'some-awesome-id', nameAsRegex: true },
      'test-id'
    ); // the previous textbox value is kept
    await userEvent.clear(textbox);
    await userEvent.type(textbox, 'some-regexp');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { channelName: 'some-regexp', nameAsRegex: true },
      'test-id'
    );
  });
});
