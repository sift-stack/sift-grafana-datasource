import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VisualSiftQueryEditor } from './VisualSiftQueryEditor';
import { SiftDataSource } from '../datasource';
import { QueryEditor } from './query-editor/QueryEditor';
import { QueryTypes } from '../types';
import { OpenInSiftButton } from './sharelink/OpenInSiftButton';

// Mock the QueryEditor component
jest.mock('./query-editor/QueryEditor', () => ({
  QueryEditor: jest.fn(() => <div data-testid="mock-query-editor" />),
}));

// Mock the OpenInSiftButton component
jest.mock('./sharelink/OpenInSiftButton', () => ({
  SharelinkMenuItem: jest.fn(() => <div data-testid="mock-sharelink-menu-item" />),
}));

// Mock the useFetchSharelinkMetadata hook
jest.mock('../resources.hooks', () => ({
  useFetchSharelinkMetadata: jest.fn(() => ({
    shareLinkItems: {
      channelIds: [],
      assetIds: [],
      runIds: [],
      calculatedChannels: [],
    },
  })),
}));

// Create a mock for the datasource
const createMockDatasource = () => ({
  migrateQuery: jest.fn(),
  getApiRestUrl: jest.fn(() => 'https://sift.example.com'),
  clearCache: jest.fn(),
  postResource: jest.fn().mockResolvedValue(undefined),
});

describe('VisualSiftQueryEditor', () => {
  let mockDatasource: any;
  let mockOnChange: jest.Mock;
  let mockOnRunQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatasource = createMockDatasource();
    mockOnChange = jest.fn();
    mockOnRunQuery = jest.fn();
  });

  describe('Query Migration', () => {
    it('migrates legacy query on initial render', async () => {
      const initialQuery = { refId: 'A' };
      const migratedQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(migratedQuery);

      render(
        <VisualSiftQueryEditor
          query={initialQuery as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for the migration to complete
      await waitFor(() => {
        expect(mockDatasource.migrateQuery).toHaveBeenCalledWith(initialQuery);
        expect(mockOnChange).toHaveBeenCalledWith(migratedQuery);
      });
    });

    it('sets queryMode to CALCULATED_CHANNEL if migrated query has calculated channels', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            calculatedChannelQueries: [{ name: 'calc1', expression: 'expr', channelReferences: [] }],
          },
        ],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Calculated Channels')).toBeInTheDocument();
        const radioButton = screen.getByLabelText('Calculated Channels');
        expect(radioButton).toBeChecked();
      });
    });

    it('sets queryMode to CHANNEL if migrated query has no calculated channels', async () => {
      const initialQuery = { refId: 'A' };
      const migratedQuery = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [
          {
            assetQueries: [{ assetId: 'asset1' }],
            runQueries: [{ runId: 'run1' }],
            channelQueries: [{ channelId: 'channel1' }],
          },
        ],
      };

      mockDatasource.migrateQuery.mockResolvedValue(migratedQuery);

      render(
        <VisualSiftQueryEditor
          query={initialQuery as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for migration to complete and onChange to be called
      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            channelDataQueries: expect.any(Array),
          })
        );
      });

      // Wait for the loading state to finish
      await waitFor(() => {
        expect(screen.queryByTestId('loading-migration-placeholder')).not.toBeInTheDocument();
      });

      // Then check for the radio button
      await waitFor(() => {
        expect(screen.getByText('Channels')).toBeInTheDocument();
        const radioButton = screen.getByLabelText('Channels');
        expect(radioButton).toBeChecked();
      });
    });
  });

  describe('Query Mode State Management', () => {
    it('changes query mode when radio button is clicked', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByText('Channels')).toBeInTheDocument();
      });

      // Initially, Channels should be selected
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons[0]).toBeChecked();
      expect(radioButtons[1]).not.toBeChecked();

      // Click on Calculated Channel
      fireEvent.click(radioButtons[1]);

      // Now Calculated Channel should be selected
      expect(radioButtons[0]).not.toBeChecked();
      expect(radioButtons[1]).toBeChecked();

      expect(QueryEditor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryType: QueryTypes.CALCULATED_CHANNEL,
        }),
        expect.anything()
      );
    });
  });

  describe('Group By Functionality', () => {
    it('updates combineRuns when checkbox is clicked', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
        combineRuns: false,
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByText('GROUP BY')).toBeInTheDocument();
      });

      // Find the checkbox and ensure it's initially unchecked
      const checkbox = screen.getByLabelText('Combine Runs');
      expect(checkbox).not.toBeChecked();

      // Click the checkbox
      fireEvent.click(checkbox);

      // Verify that onChange was called with updated query
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          combineRuns: true,
        })
      );

      // Verify that onRunQuery was called
      expect(mockOnRunQuery).toHaveBeenCalled();
    });
  });

  describe('Channel Data Queries Update', () => {
    it('updates channel data queries and runs query', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByTestId('mock-query-editor')).toBeInTheDocument();
      });

      // Get the onUpdateChannelDataQueries prop passed to QueryEditor
      const { onUpdateChannelDataQueries } = (QueryEditor as jest.Mock).mock.calls[0][0];

      // Call the callback with new channel data queries
      const newChannelDataQueries = [
        {
          assetQueries: [{ assetId: 'new-asset' }],
          runQueries: [{ runId: 'new-run' }],
          channelQueries: [{ channelId: 'new-channel' }],
        },
      ];
      await waitFor(() => onUpdateChannelDataQueries(newChannelDataQueries));

      // Verify that onChange was called with updated query
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          channelDataQueries: newChannelDataQueries,
        })
      );

      // Verify that onRunQuery was called
      expect(mockOnRunQuery).toHaveBeenCalled();
    });

    it('does not run query if the query is unchanged', async () => {
      const channelDataQueries = [
        {
          assetQueries: [{ assetId: 'asset1' }],
          runQueries: [{ runId: 'run1' }],
          channelQueries: [{ channelId: 'channel1' }],
        },
      ];

      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries,
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByTestId('mock-query-editor')).toBeInTheDocument();
      });

      // Get the onUpdateChannelDataQueries prop passed to QueryEditor
      const { onUpdateChannelDataQueries } = (QueryEditor as jest.Mock).mock.calls[0][0];

      // Call the callback with the same channel data queries
      await waitFor(() => onUpdateChannelDataQueries(channelDataQueries));

      // Reset the mocks to check if they're called again
      mockOnChange.mockClear();
      mockOnRunQuery.mockClear();

      await waitFor(() => onUpdateChannelDataQueries(channelDataQueries));

      // Verify that onChange and onRunQuery were not called again
      expect(mockOnChange).not.toHaveBeenCalled();
      expect(mockOnRunQuery).not.toHaveBeenCalled();
    });
  });

  describe('Cache Clearing Functionality', () => {
    it('clears cache and runs query when refresh button is clicked', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      // Add clearCache method to the mock datasource
      mockDatasource.clearCache = jest.fn();
      mockDatasource.migrateQuery.mockResolvedValue(query);

      // Add panelId to the props
      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
          data={{ request: { panelId: 123 } } as any}
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByText('Query Mode')).toBeInTheDocument();
      });

      // Find the refresh button by its tooltip
      const refreshButton = screen.getByRole('button', { name: /Clear query cache and refresh query/i });
      expect(refreshButton).toBeInTheDocument();

      // Click the refresh button
      fireEvent.click(refreshButton);

      // Verify that clearCache was called with the correct panel ID
      expect(mockDatasource.clearCache).toHaveBeenCalledWith(123);

      // Verify that onRunQuery was called to refresh the data
      expect(mockOnRunQuery).toHaveBeenCalled();
    });

    it('uses default panel ID when panel ID is not available', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      // Add clearCache method to the mock datasource
      mockDatasource.clearCache = jest.fn();
      mockDatasource.migrateQuery.mockResolvedValue(query);

      // Render without providing a panelId
      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
          // No data prop provided, so panelId should default to -1
        />
      );

      // Wait for the component to render after migration
      await waitFor(() => {
        expect(screen.getByText('Query Mode')).toBeInTheDocument();
      });

      // Find the refresh button
      const refreshButton = screen.getByRole('button', { name: /Clear query cache and refresh query/i });

      // Click the refresh button
      fireEvent.click(refreshButton);

      // Verify that clearCache was called with the default panel ID (-1)
      expect(mockDatasource.clearCache).toHaveBeenCalledWith(-1);

      // Verify that onRunQuery was called
      expect(mockOnRunQuery).toHaveBeenCalled();
    });
  });

  describe('Time Range Handling', () => {
    it('computes shareLinkTimeRange from range prop with Date objects', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      const fromDate = new Date('2024-01-01T00:00:00Z');
      const toDate = new Date('2024-01-02T00:00:00Z');

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
          range={{
            from: fromDate as any,
            to: toDate as any,
            raw: { from: fromDate.toISOString(), to: toDate.toISOString() },
          }}
        />
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading-migration-placeholder')).not.toBeInTheDocument();
      });

      // Verify OpenInSiftButton was called with the correct timeRange
      expect(OpenInSiftButton).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: {
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
          },
        }),
        expect.anything()
      );
    });

    it('handles range prop with string values', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      const fromIsoString = '2024-01-03T12:34:56.789Z';
      const toIsoString = '2024-01-04T12:34:56.789Z';

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
          range={{
            from: fromIsoString as any,
            to: toIsoString as any,
            raw: { from: fromIsoString, to: toIsoString },
          }}
        />
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading-migration-placeholder')).not.toBeInTheDocument();
      });

      // Verify OpenInSiftButton was called with the stringified timeRange
      expect(OpenInSiftButton).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: {
            from: fromIsoString,
            to: toIsoString,
          },
        }),
        expect.anything()
      );
    });

    it('passes undefined timeRange when range prop is not provided', async () => {
      const query = {
        refId: 'A',
        queryVersion: '2',
        channelDataQueries: [],
      };

      mockDatasource.migrateQuery.mockResolvedValue(query);

      render(
        <VisualSiftQueryEditor
          query={query as any}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource as unknown as SiftDataSource}
        />
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading-migration-placeholder')).not.toBeInTheDocument();
      });

      // Verify OpenInSiftButton was called with undefined timeRange
      expect(OpenInSiftButton).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: undefined,
        }),
        expect.anything()
      );
    });
  });
});
