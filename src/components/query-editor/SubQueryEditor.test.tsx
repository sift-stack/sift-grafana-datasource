import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubQueryEditor } from './SubQueryEditor';
import { useFetchAssets, useFetchRuns, useFetchChannels, useSiftAssetVariables } from '../../resources.hooks';
import { QueryTypes } from '../../types';

jest.mock('../../resources.hooks', () => ({
  useFetchChannels: jest.fn(),
  useFetchAssets: jest.fn(),
  useFetchRuns: jest.fn(),
  useSiftAssetVariables: jest.fn(),
}));

// ESM package issues with nanoid when used with jest
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

describe('SubQueryEditor', () => {
  const defaultProps = {
    datasource: createMockSiftDataSource(),
    channelDataQueryId: 'test-id',
    channelDataQuery: {},
    onUpdateQuery: jest.fn(),
    addQuery: jest.fn(),
    removeQuery: jest.fn(),
    cloneQuery: jest.fn(),
    canRemove: true,
    assetQueryIndex: 0,
    queryType: QueryTypes.CHANNEL,
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
      assets: [{ assetId: 'a1', name: 'Asset 1' }],
      loading: false,
      loadAssets: jest.fn(),
    });
    (useFetchRuns as jest.Mock).mockReturnValue({
      runs: [{ runId: 'r1', name: 'Run 1' }],
      loading: false,
      loadRuns: jest.fn(),
    });
    (useSiftAssetVariables as jest.Mock).mockReturnValue([
      { name: 'assetVar', label: 'AssetVar' },
      { name: 'runVar', label: 'RunVar' },
    ]);
    jest.clearAllMocks();
  });

  it('renders Asset and Run labels, Selects, remove button, and add button', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    expect(screen.getByText('SELECT')).toBeInTheDocument();
    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    // There should be three SelectableTypeInputs (comboboxes)
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBe(3); // Asset, Run, Channel
    // Remove, clone, add buttons
    const removeButton = screen.getByRole('button', { name: /remove asset/i });
    expect(removeButton).toBeInTheDocument();
    const cloneButton = screen.getByRole('button', { name: /clone asset/i });
    expect(cloneButton).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: /insert asset/i });
    expect(addButton).toBeInTheDocument();
    // Channel add/remove
    const removeChannelButton = screen.getByRole('button', { name: /remove channel/i });
    expect(removeChannelButton).toBeInTheDocument();
    const addChannelButton = screen.getByRole('button', { name: /insert channel/i });
    expect(addChannelButton).toBeInTheDocument();
  });

  it('renders additional items in calculated channel mode', async () => {
    render(<SubQueryEditor {...defaultProps} queryType={QueryTypes.CALCULATED_CHANNEL} />);
    expect(screen.getByText('SELECT')).toBeInTheDocument();
    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('NAME')).toBeInTheDocument();
    expect(screen.getByText('EXPRESSION')).toBeInTheDocument();
    // There should be three SelectableTypeInputs (comboboxes)
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBe(3); // Asset, Run, Channel
    // Remove, clone, and add buttons
    const removeButton = screen.getByRole('button', { name: /remove calculation/i });
    expect(removeButton).toBeInTheDocument();
    const cloneButton = screen.getByRole('button', { name: /clone calculation/i });
    expect(cloneButton).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: /insert calculation/i });
    expect(addButton).toBeInTheDocument();
    // Channel add/remove
    const removeChannelButton = screen.getByRole('button', { name: /remove channel/i });
    expect(removeChannelButton).toBeInTheDocument();
    const addChannelButton = screen.getByRole('button', { name: /insert channel/i });
    expect(addChannelButton).toBeInTheDocument();

    // Expression input
    expect(screen.getByPlaceholderText('Enter an expression')).toBeInTheDocument();

    // Name input
    expect(screen.getByPlaceholderText('Enter a calculation name')).toBeInTheDocument();
  });

  it('calls onUpdateQuery when an asset is selected', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const assetSelect = screen.getAllByRole('combobox')[0];
    await userEvent.click(assetSelect);
    const option = screen.getByText(/asset 1/i);
    await userEvent.click(option);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        assetQueries: [expect.objectContaining({ assetId: 'a1', assetName: 'Asset 1', asSelect: true })],
      }),
      'test-id'
    );
  });

  it('calls onUpdateQuery when a run is selected', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const runSelect = screen.getAllByRole('combobox')[1];
    await userEvent.click(runSelect);
    const option = screen.getByText(/run 1/i);
    await userEvent.click(option);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        runQueries: [expect.objectContaining({ runId: 'r1', runName: 'Run 1', asSelect: true })],
      }),
      'test-id'
    );
  });

  it('calls onUpdateQuery when asset textbox is used', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    // Switch asset input to text
    const changeTypeButton = screen.getAllByRole('button', { name: /change input type/i })[0];
    await userEvent.click(changeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    const textbox = screen.getByPlaceholderText(/enter an asset name/i);
    await userEvent.type(textbox, 'Custom Asset');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetName: 'Custom Asset' })] },
      'test-id'
    );
  });

  it('calls onUpdateQuery when run textbox is used', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    // Switch run input to text
    const changeTypeButton = screen.getAllByRole('button', { name: /change input type/i })[1];
    await userEvent.click(changeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    const textbox = screen.getByPlaceholderText(/Filter by run name/i);
    await userEvent.type(textbox, 'Custom Run');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runName: 'Custom Run' })] },
      'test-id'
    );
  });

  it('disables remove button if canRemove is false', async () => {
    render(<SubQueryEditor {...defaultProps} canRemove={false} />);
    const removeButton = screen.getByRole('button', { name: /remove asset/i });
    expect(removeButton).toBeInTheDocument();
    await userEvent.click(removeButton!);
    expect(defaultProps.removeQuery).not.toHaveBeenCalled();
  });

  it('calls addQuery when add button is clicked', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const addButton = screen.getByRole('button', { name: /insert asset/i });
    expect(addButton).toBeInTheDocument();
    await userEvent.click(addButton!);
    expect(defaultProps.addQuery).toHaveBeenCalledWith('test-id');
  });

  it('calls cloneQuery when clone button is clicked', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const cloneButton = screen.getByRole('button', { name: /clone asset/i });
    expect(cloneButton).toBeInTheDocument();
    await userEvent.click(cloneButton!);
    expect(defaultProps.cloneQuery).toHaveBeenCalledWith('test-id');
  });

  it('calls onUpdateQuery for asset input with text, id, and regex types', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const assetChangeTypeButton = screen.getAllByRole('button', { name: /change input type/i })[0];
    await userEvent.click(assetChangeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    const assetTextbox = screen.getByPlaceholderText(/enter an asset name/i);
    await userEvent.type(assetTextbox, 'my custom asset');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetName: 'my custom asset' })] },
      'test-id'
    );
    // ID
    await userEvent.click(assetChangeTypeButton);
    const idMenuItem = screen.getByRole('menuitem', { name: /id/i });
    await userEvent.click(idMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetId: 'my custom asset' })] },
      'test-id'
    );
    await userEvent.clear(assetTextbox);
    await userEvent.type(assetTextbox, 'some-awesome-id');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetId: 'some-awesome-id' })] },
      'test-id'
    );
    // Regex
    await userEvent.click(assetChangeTypeButton);
    const regexMenuItem = screen.getByRole('menuitem', { name: /regex/i });
    await userEvent.click(regexMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetName: 'some-awesome-id', nameAsRegex: true })] },
      'test-id'
    );
    await userEvent.clear(assetTextbox);
    await userEvent.type(assetTextbox, 'some-regexp');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { assetQueries: [expect.objectContaining({ assetName: 'some-regexp', nameAsRegex: true })] },
      'test-id'
    );
  });

  it('calls onUpdateQuery for run input with text, id, and regex types', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    const runChangeTypeButton = screen.getAllByRole('button', { name: /change input type/i })[1];
    await userEvent.click(runChangeTypeButton);
    const textMenuItem = screen.getByRole('menuitem', { name: /text/i });
    await userEvent.click(textMenuItem);
    const runTextbox = screen.getByPlaceholderText(/filter by run/i);
    await userEvent.type(runTextbox, 'my custom run');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runName: 'my custom run' })] },
      'test-id'
    );
    // ID
    await userEvent.click(runChangeTypeButton);
    const idMenuItem = screen.getByRole('menuitem', { name: /id/i });
    await userEvent.click(idMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runId: 'my custom run' })] },
      'test-id'
    );
    await userEvent.clear(runTextbox);
    await userEvent.type(runTextbox, 'some-run-id');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runId: 'some-run-id' })] },
      'test-id'
    );
    // Regex
    await userEvent.click(runChangeTypeButton);
    const regexMenuItem = screen.getByRole('menuitem', { name: /regex/i });
    await userEvent.click(regexMenuItem);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runName: 'some-run-id', nameAsRegex: true })] },
      'test-id'
    );
    await userEvent.clear(runTextbox);
    await userEvent.type(runTextbox, 'some-run-regexp');
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      { runQueries: [expect.objectContaining({ runName: 'some-run-regexp', nameAsRegex: true })] },
      'test-id'
    );
  });

  it('calls onUpdateQuery for calculated channel', async () => {
    render(<SubQueryEditor {...defaultProps} queryType={QueryTypes.CALCULATED_CHANNEL} />);
    const calcNameTextbox = screen.getByPlaceholderText(/enter a calculation name/i);
    await userEvent.type(calcNameTextbox, 'my-calculation');
    // Ensure it hasn't been called until after blur
    expect(defaultProps.onUpdateQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ calculatedChannelQueries: [expect.objectContaining({ name: 'my-calculation' })] }),
      'test-id'
    );
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({ calculatedChannelQueries: [expect.objectContaining({ name: 'my-calculation' })] }),
      'test-id'
    );

    const calcExpressionTextbox = screen.getByPlaceholderText(/enter an expression/i);
    await userEvent.type(calcExpressionTextbox, '$1 + $2');
    // Ensure it hasn't been called until after blur
    expect(defaultProps.onUpdateQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ calculatedChannelQueries: [expect.objectContaining({ expression: '$1 + $2' })] }),
      'test-id'
    );
    await userEvent.tab();
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({ calculatedChannelQueries: [expect.objectContaining({ expression: '$1 + $2' })] }),
      'test-id'
    );
  });

  it('adds a new channel and updates the query as expected', async () => {
    render(<SubQueryEditor {...defaultProps} />);
    let comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBe(3);

    const addChannelButton = screen.getByRole('button', { name: /insert channel/i });
    await userEvent.click(addChannelButton);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalled();

    comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBe(4);
  });

  it('adds a new channel and updates the query as expected, with calculated channel', async () => {
    render(<SubQueryEditor {...defaultProps} queryType={QueryTypes.CALCULATED_CHANNEL} />);
    let comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBe(3);

    const addChannelButton = screen.getByRole('button', { name: /insert channel/i });
    await userEvent.click(addChannelButton);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        calculatedChannelQueries: [
          expect.objectContaining({
            channelReferences: [
              { channelReference: '$1', asSelect: true },
              { channelReference: '$2', asSelect: true },
            ],
          }),
        ],
      }),
      'test-id'
    );

    comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBe(4);
  });

  it('inserts a new channel between two rendered channels and renders the new input', async () => {
    // Render with two channels in channelQueries
    const multiChannelProps = {
      ...defaultProps,
      channelDataQuery: {
        assetQueries: [],
        runQueries: [],
        channelQueries: [
          { channelName: 'Channel1', nameAsRegex: true },
          { channelId: 'ch2', asSelect: true },
        ],
      },
    };
    render(<SubQueryEditor {...multiChannelProps} />);
    let channelInputs = screen.getAllByRole('combobox');
    expect(channelInputs.length).toBe(3);
    const insertButtons = screen.getAllByRole('button', { name: /insert channel/i });
    // Insert between the two (should be the first button)
    await userEvent.click(insertButtons[0]);
    const expectedChannelQueries = [
      { channelName: 'Channel1', nameAsRegex: true },
      { asSelect: true },
      {
        channelId: 'ch2',
        asSelect: true,
      },
    ];
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        channelQueries: expectedChannelQueries,
      }),
      'test-id'
    );
  });

  it('deletes the correct channel', async () => {
    // Render with three channels in channelQueries
    const multiChannelProps = {
      ...defaultProps,
      channelDataQuery: {
        assetQueries: [],
        runQueries: [],
        channelQueries: [{ channelId: 'ch1' }, { channelId: 'ch2' }, { channelId: 'ch3' }],
      },
    };
    render(<SubQueryEditor {...multiChannelProps} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove channel/i });
    // Remove the second channel
    await userEvent.click(removeButtons[1]);
    expect(defaultProps.onUpdateQuery).toHaveBeenCalled();
    const expectedChannelQueries = [{ channelId: 'ch1' }, { channelId: 'ch3' }];
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        channelQueries: expectedChannelQueries,
      }),
      'test-id'
    );
  });

  it('renders correct input types for pre-defined channelQueries', async () => {
    const multiTypeProps = {
      ...defaultProps,
      channelDataQuery: {
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
    };
    render(<SubQueryEditor {...multiTypeProps} />);

    // Channel remove - quick way to count number of rows
    const removeChannelButtons = screen.getAllByRole('button', { name: /remove channel/i });
    expect(removeChannelButtons.length).toBe(5);

    // Should render three channel inputs (comboboxes) + 2 for asset/run
    const comboBoxes = screen.getAllByRole('combobox');
    expect(comboBoxes.length).toBe(4); // asSelect: true
    expect(screen.getByText('Channel 1')).toBeInTheDocument();
    expect(screen.getByText(/select a channel/i)).toBeInTheDocument();
    // Regex channel should render a textbox
    expect(screen.getByDisplayValue('RegexChannel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ch4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SomeChannel')).toBeInTheDocument();
  });

  it('allows selecting dashboard variables for asset selection', async () => {
    render(<SubQueryEditor {...defaultProps} />);

    const changeTypeButton = screen.getAllByRole('button', { name: /change input type/i })[0];
    await userEvent.click(changeTypeButton);

    const dashboardMenuItem = screen.getByRole('menuitem', { name: /dashboard variables/i });
    await userEvent.click(dashboardMenuItem);

    const assetSelect = screen.getAllByRole('combobox')[0];
    await userEvent.click(assetSelect);

    // Select the asset variable
    const assetVarOption = screen.getByText('$assetVar');
    await userEvent.click(assetVarOption);

    // Verify the correct query update was called
    expect(defaultProps.onUpdateQuery).toHaveBeenCalledWith(
      {
        assetQueries: [{ dashboardVariableName: '${assetVar}' }],
      },
      'test-id'
    );
  });
});
