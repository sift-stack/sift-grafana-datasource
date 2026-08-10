import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { QueryEditorProps } from '@grafana/data';
import {
  Checkbox,
  Icon,
  IconButton,
  InlineField,
  InlineFieldRow,
  InlineLabel,
  RadioButtonGroup,
  Select,
} from '@grafana/ui';
import { SiftDataSource } from '../datasource';
import {
  ChannelDataQuery,
  QueryType,
  QueryTypes,
  SiftDataSourceOptions,
  SiftQuery,
  EnumDisplayType
} from '../types';
import { ensureQueryDefaults } from '../utils';
import { Section } from './common/Section';
import { QueryEditor } from './query-editor/QueryEditor';
import { OpenInSiftButton } from './sharelink/OpenInSiftButton';
import { useFetchSharelinkMetadata } from '../resources.hooks';

type Props = QueryEditorProps<SiftDataSource, SiftQuery, SiftDataSourceOptions>;

export const VisualSiftQueryEditor = (props: Props) => {
  const { query, onChange, onRunQuery, datasource, data, range } = props;
  const panelId = typeof data?.request?.panelId === 'number' ? data.request.panelId : -1;

  const [loading, setLoading] = useState(true);
  const [queryMode, setQueryMode] = useState<QueryType>(QueryTypes.CHANNEL);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [initialRender, setInitialRender] = useState(true);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const queryRef = useRef(query);
  const shareLinkTimeRange = useMemo(() => {
    if (!range) {
      return undefined;
    }
    return {
      from: range.from?.toISOString?.() ?? String(range.from ?? ''),
      to: range.to?.toISOString?.() ?? String(range.to ?? ''),
    };
  }, [range]);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const { shareLinkItems } = useFetchSharelinkMetadata(datasource, query, !loading);

  // After initial render, we will perform migrations. This ensures the component renders in Mixed Mode
  useEffect(() => {
    const timer = setTimeout(() => {
      setInitialRender(false); // Trigger migration after initial render
    }, 0);

    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  useEffect(() => {
    if (!loading || initialRender) {
      return;
    } // Only migrate once and after initial render

    async function migrateQuery() {
      // Only migrate if needed or if query has changed
      const migratedQuery = await datasource.migrateQuery(query);

      // Only update if there's a difference to avoid infinite loops
      if (JSON.stringify(migratedQuery) !== JSON.stringify(query)) {
        onChange(migratedQuery);
      }

      const calculatedQueries =
        migratedQuery?.channelDataQueries?.filter(
          (q) => q.calculatedChannelQueries && q.calculatedChannelQueries.length
        ) ?? [];
      setQueryMode(calculatedQueries.length ? QueryTypes.CALCULATED_CHANNEL : QueryTypes.CHANNEL);
      setLoading(false);
    }
    void migrateQuery();
  }, [query, datasource, onChange, initialRender, loading]); // Re-run when query changes

  const onUpdateQuery = useCallback(
    (query: SiftQuery) => {
      const queryString = JSON.stringify(query);
      setLastQuery((prevLastQuery) => {
        // If the last query was the same as this, don't auto run query
        if (prevLastQuery !== queryString) {
          onChange(query);
          onRunQuery();
          return queryString;
        }
        return prevLastQuery;
      });
    },
    [onChange, onRunQuery]
  );

  const onUpdateChannelDataQueries = useCallback(
    (channelDataQueries: ChannelDataQuery[]) => {
      const latestQuery = queryRef.current;
      const updatedQuery = ensureQueryDefaults({
        ...latestQuery,
        channelDataQueries,
      });
      onUpdateQuery(updatedQuery as SiftQuery);
    },
    [onUpdateQuery]
  );

  const apiRestUrl = datasource.getApiRestUrl();
  const frontendUrl = typeof datasource.getFrontendUrl === 'function'
    ? datasource.getFrontendUrl()
    : undefined;

  if (loading) {
    return <div data-testid="loading-migration-placeholder">Migrating query versions...</div>;
  }

  return (
    <div>
      <InlineFieldRow>
        <InlineField label={'Query Mode'} labelWidth={12}>
          <RadioButtonGroup
            value={queryMode}
            options={[
              { label: 'Channels', value: QueryTypes.CHANNEL },
              { label: 'Calculated Channels', value: QueryTypes.CALCULATED_CHANNEL },
            ]}
            onChange={(v) => {
              setQueryMode(v as QueryType);
            }}
          />
        </InlineField>
        <InlineLabel width="auto" transparent>
          <IconButton
            name="sync"
            tooltip="Clear query cache and refresh query"
            size="xs"
            onClick={() => {
              datasource.clearCache(panelId);
              onRunQuery();
            }}
          />
        </InlineLabel>
        <InlineLabel width="auto" transparent>
          <div
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '4px', userSelect: 'none' }}
          >
            <Icon name={showMoreOptions ? 'angle-down' : 'angle-right'} />
            <span>More Options</span>
          </div>
        </InlineLabel>
        <OpenInSiftButton
          items={shareLinkItems}
          apiBaseUrl={apiRestUrl}
          frontendUrl={frontendUrl}
          timeRange={shareLinkTimeRange}
        />

      </InlineFieldRow>
      {showMoreOptions && (
        <Section label="Options">
          <InlineField
            label="Enum Display"
            labelWidth={15}
            tooltip="Choose which enum values are returned: Value (integer, String (name), or Both"
          >
            <Select
              options={[
                {
                  label: 'Both',
                  value: 'both',
                  description: 'E.g. chan-name_string and chan-name_value',
                },
                { label: 'String only', value: 'string' },
                { label: 'Value only', value: 'value' },
              ]}
              value={query.enumDisplay ?? 'both'}
              onChange={(v) => onUpdateQuery({ ...query, enumDisplay: v.value as EnumDisplayType })}
              width={20}
            />
          </InlineField>
          <InlineLabel
            width="auto"
            tooltip="Enable to always query data from Sift at full fidelity, at the cost of longer query times."
          >
            <Checkbox
              label="Disable Downsampling"
              checked={query.skipDownsampling ?? false}
              onChange={(e) => onUpdateQuery({ ...query, skipDownsampling: e.currentTarget.checked })}
            />
          </InlineLabel>
        </Section>
      )}
      <QueryEditor
        datasource={datasource}
        queryType={queryMode}
        channelDataQueries={query.channelDataQueries ?? []}
        onUpdateChannelDataQueries={onUpdateChannelDataQueries}
      />
      <Section label="GROUP BY">
        <InlineLabel
          width="auto"
          tooltip="Combine runs into a single result. Otherwise, each run will produce a separate column for each channel."
        >
          <Checkbox
            label="Combine Runs"
            checked={query.combineRuns ?? true}
            onChange={(e) => onUpdateQuery({ ...query, combineRuns: e.currentTarget.checked })}
          />
        </InlineLabel>
        <InlineLabel
          width="auto"
          tooltip="Group channels that share the same name and data type into a single series. Use this to combine assets with common channel names."
        >
          <Checkbox
            label="Group by Channel Name"
            checked={query.groupByChannelName ?? false}
            onChange={(e) => onUpdateQuery({ ...query, groupByChannelName: e.currentTarget.checked })}
          />
        </InlineLabel>
      </Section>
      {/*TODO: aliasing <Section label="ALIAS"></Section >*/}
    </div>
  );
};
