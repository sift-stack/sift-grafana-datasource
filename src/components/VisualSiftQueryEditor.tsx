import React, { useEffect, useCallback, useState, useRef } from 'react';

import { RadioButtonGroup, InlineFieldRow, InlineField, Checkbox, InlineLabel, IconButton } from '@grafana/ui';
import { Section } from './common/Section';
import { QueryEditorProps } from '@grafana/data';
import { SiftDataSource } from '../datasource';
import { ChannelDataQuery, SiftDataSourceOptions, SiftQuery, QueryTypes, QueryType } from '../types';
import { QueryEditor } from './query-editor/QueryEditor';

type Props = QueryEditorProps<SiftDataSource, SiftQuery, SiftDataSourceOptions>;

export const VisualSiftQueryEditor = (props: Props) => {
  const { query, onChange, onRunQuery, datasource, data } = props;
  const panelId = typeof data?.request?.panelId === 'number' ? data.request.panelId : -1;

  const [loading, setLoading] = useState(true);
  const [queryMode, setQueryMode] = useState<QueryType>(QueryTypes.CHANNEL);
  const [lastQuery, setLastQuery] = useState<string>('');

  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Migrate legacy query if necessary
  useEffect(() => {
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
  }, [query, datasource, onChange]); // Re-run when query changes

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
      onUpdateQuery({ ...latestQuery, channelDataQueries });
    },
    [onUpdateQuery]
  );

  if (loading) {
    return <div data-testid="loading-migration-placeholder" />;
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
