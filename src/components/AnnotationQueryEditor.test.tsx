import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnnotationQueryEditor } from './AnnotationQueryEditor';
import { SiftDataSource } from '../datasource';
import { QUERY_VERSION } from '../types';

// Mock the VisualSiftQueryEditor component
jest.mock('./VisualSiftQueryEditor', () => ({
  VisualSiftQueryEditor: jest.fn(() => <div data-testid="mock-visual-query-editor" />),
}));

// Mock the useFetchSharelinkMetadata hook (used by VisualSiftQueryEditor)
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

const createMockDatasource = () =>
  ({
    migrateQuery: jest.fn(),
    getApiRestUrl: jest.fn(() => 'https://sift.example.com'),
    getFrontendUrl: jest.fn(() => undefined),
    clearCache: jest.fn(),
    postResource: jest.fn().mockResolvedValue(undefined),
  }) as unknown as SiftDataSource;

describe('AnnotationQueryEditor', () => {
  let mockDatasource: SiftDataSource;
  let mockOnChange: jest.Mock;
  let mockOnRunQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatasource = createMockDatasource();
    mockOnChange = jest.fn();
    mockOnRunQuery = jest.fn();
  });

  describe('onChange always includes queryVersion', () => {
    it('includes queryVersion on initialization when query has no queryVersion', async () => {
      const query = {
        refId: 'Anno',
        annotationType: undefined,
        annotationFilter: '',
      } as any;

      render(
        <AnnotationQueryEditor
          query={query}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource}
        />
      );

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
      });

      // Every onChange call must include queryVersion
      for (const call of mockOnChange.mock.calls) {
        expect(call[0]).toHaveProperty('queryVersion', QUERY_VERSION);
      }
    });

    it('includes queryVersion on initialization when query already has queryVersion', async () => {
      const query = {
        refId: 'Anno',
        queryVersion: QUERY_VERSION,
        annotationType: undefined,
      } as any;

      render(
        <AnnotationQueryEditor
          query={query}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource}
        />
      );

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
      });

      for (const call of mockOnChange.mock.calls) {
        expect(call[0]).toHaveProperty('queryVersion', QUERY_VERSION);
      }
    });

    it('includes queryVersion when switching annotation type', async () => {
      const query = {
        refId: 'Anno',
        queryVersion: QUERY_VERSION,
        annotationType: 'annotationsQuery',
        annotationFilter: '',
      } as any;

      render(
        <AnnotationQueryEditor
          query={query}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource}
        />
      );

      // Wait for initialization
      await waitFor(() => {
        expect(screen.getByText('Sift Annotations')).toBeInTheDocument();
      });

      // Switch to Data Query
      const dataQueryRadio = screen.getByLabelText('Data Query');
      fireEvent.click(dataQueryRadio);

      // Every onChange call must include queryVersion
      for (const call of mockOnChange.mock.calls) {
        expect(call[0]).toHaveProperty('queryVersion', QUERY_VERSION);
      }
    });

    it('includes queryVersion when annotation filter is changed', async () => {
      const query = {
        refId: 'Anno',
        queryVersion: QUERY_VERSION,
        annotationType: 'annotationsQuery',
        annotationFilter: '',
      } as any;

      render(
        <AnnotationQueryEditor
          query={query}
          onChange={mockOnChange}
          onRunQuery={mockOnRunQuery}
          datasource={mockDatasource}
        />
      );

      // Wait for initialization
      await waitFor(() => {
        expect(screen.getByPlaceholderText("example: asset_name == 'rover_1'")).toBeInTheDocument();
      });

      // Type in the filter input and blur to trigger onChange
      const filterInput = screen.getByPlaceholderText("example: asset_name == 'rover_1'");
      fireEvent.change(filterInput, { target: { value: "asset_name=='test'" } });
      fireEvent.blur(filterInput);

      // Every onChange call must include queryVersion
      for (const call of mockOnChange.mock.calls) {
        expect(call[0]).toHaveProperty('queryVersion', QUERY_VERSION);
      }
    });
  });
});
