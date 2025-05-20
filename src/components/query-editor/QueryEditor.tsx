import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { nanoid } from 'nanoid';
import { ChannelDataQuery, ChannelDataQueryId, QueryType } from '../../types';
import { SiftDataSource } from '../../datasource';
import { useStyles2 } from '@grafana/ui';
import { getStyles } from '../common/Common.style';
import { SubQueryEditor } from './SubQueryEditor';
import { deleteValue, insertAfter, fillInDefaultChannelDataQueries } from '../../utils';
import { DEFAULT_CHANNEL_DATA_QUERY } from '../../constants';

interface Props {
  datasource: SiftDataSource;
  queryType: QueryType;
  channelDataQueries: ChannelDataQuery[];
  onUpdateChannelDataQueries: (channelDataQueries: ChannelDataQuery[]) => void;
}
export const QueryEditor = ({ datasource, queryType, channelDataQueries, onUpdateChannelDataQueries }: Props) => {
  const [channelDataQueryMap, setChannelDataQueryMap] = useState<Map<ChannelDataQueryId, ChannelDataQuery>>(
    new Map(fillInDefaultChannelDataQueries(queryType, channelDataQueries).map((query, index) => [nanoid(), query]))
  );
  const [channelDataQueryOrder, setChannelDataQueryOrder] = useState<ChannelDataQueryId[]>(
    Array.from(channelDataQueryMap.keys())
  );

  const orderedChannelDataQueryMap = useMemo(
    () =>
      channelDataQueryOrder.reduce((map, key) => {
        map.set(key, channelDataQueryMap.get(key)!);
        return map;
      }, new Map<ChannelDataQueryId, ChannelDataQuery>()),
    [channelDataQueryMap, channelDataQueryOrder]
  );

  const addChannelDataQuery = useCallback((afterQueryId: ChannelDataQueryId) => {
    const newQueryId = nanoid();
    setChannelDataQueryOrder((prevOrder) => insertAfter(prevOrder, afterQueryId, newQueryId));
    setChannelDataQueryMap((prevMap) => {
      const newMap = new Map(prevMap);
      newMap.set(newQueryId, DEFAULT_CHANNEL_DATA_QUERY);
      return newMap;
    });
  }, []);

  const cloneChannelDataQuery = useCallback((queryId: ChannelDataQueryId) => {
    const newQueryId = nanoid();
    setChannelDataQueryOrder((prevOrder) => [...prevOrder, newQueryId]);
    setChannelDataQueryMap((prevMap) => {
      const newMap = new Map(prevMap);
      newMap.set(newQueryId, prevMap.get(queryId) || DEFAULT_CHANNEL_DATA_QUERY);
      return newMap;
    });
  }, []);

  const removeChannelDataQuery = useCallback((queryId: ChannelDataQueryId) => {
    setChannelDataQueryOrder((prevOrder) => deleteValue(prevOrder, queryId));
    setChannelDataQueryMap((prevMap) => {
      const newMap = new Map(prevMap);
      newMap.delete(queryId);
      return newMap;
    });
  }, []);

  // Update: Accepts a patch and merges with latest state to avoid stale prop issues
  const onUpdateChannelDataQuery = useCallback((patch: Partial<ChannelDataQuery>, queryId: ChannelDataQueryId) => {
    setChannelDataQueryMap((prevMap) => {
      const prevQuery = prevMap.get(queryId) || {};
      const merged = { ...prevQuery, ...patch };
      const newMap = new Map(prevMap);
      newMap.set(queryId, merged);
      return newMap;
    });
  }, []);

  const onUpdateChannelDataQueriesRef = useRef(onUpdateChannelDataQueries);
  useEffect(() => {
    const latestOnUpdateChannelDataQueries = onUpdateChannelDataQueriesRef.current;
    latestOnUpdateChannelDataQueries(Array.from(orderedChannelDataQueryMap.values()));
  }, [orderedChannelDataQueryMap]);

  const hasMultipleQueries = channelDataQueryMap.size > 1;

  const styles = useStyles2(getStyles);
  return (
    <>
      {Array.from(orderedChannelDataQueryMap).map(([queryId, query], index) => {
        return (
          <div key={queryId} className={cx(hasMultipleQueries && channelQueryGroupWrapperStyle)}>
            <div className={cx(hasMultipleQueries && leftBarStyle, styles.sectionGrouperBar)}></div>
            <div>
              <SubQueryEditor
                key={`channel-query-group-${queryId}`}
                datasource={datasource}
                queryType={queryType}
                channelDataQueryId={queryId}
                channelDataQuery={query}
                onUpdateQuery={onUpdateChannelDataQuery}
                addQuery={addChannelDataQuery}
                cloneQuery={cloneChannelDataQuery}
                removeQuery={removeChannelDataQuery}
                canRemove={hasMultipleQueries}
              />
            </div>
          </div>
        );
      })}
    </>
  );
};

const channelQueryGroupWrapperStyle = css`
  display: grid;
  grid-template-columns: 8px 1fr;
`;

const leftBarStyle = css`
  display: block;
  border-width: 2px;
  border-style: solid;
  width: 0;
  border-radius: 1px;
  height: auto;
  margin: 0 0 4px 0;
`;
