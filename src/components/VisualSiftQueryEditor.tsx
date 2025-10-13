import React, { useCallback, useEffect, useRef, useState } from 'react';

import { QueryEditorProps } from '@grafana/data';
import { Checkbox, IconButton, InlineField, InlineFieldRow, InlineLabel, RadioButtonGroup } from '@grafana/ui';
import { SiftDataSource } from '../datasource';
import { ChannelDataQuery, QueryType, QueryTypes, SiftDataSourceOptions, SiftQuery } from '../types';
import { ensureQueryDefaults } from '../utils';
import { Section } from './common/Section';
import { QueryEditor } from './query-editor/QueryEditor';
import { SharelinkMenuItem } from './sharelink/SharelinkMenuItem';

type Props = QueryEditorProps<SiftDataSource, SiftQuery, SiftDataSourceOptions>;

export const VisualSiftQueryEditor = (props: Props) => {
  const { query, onChange, onRunQuery, datasource, data } = props;
  const panelId = typeof data?.request?.panelId === 'number' ? data.request.panelId : -1;

  const [loading, setLoading] = useState(true);
  const [queryMode, setQueryMode] = useState<QueryType>(QueryTypes.CHANNEL);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [initialRender, setInitialRender] = useState(true);

  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

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
        <SharelinkMenuItem></SharelinkMenuItem>
      </InlineFieldRow>
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
      </Section>
      {/*TODO: aliasing <Section label="ALIAS"></Section >*/}
    </div>
  );
};
