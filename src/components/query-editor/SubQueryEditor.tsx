import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ChannelDataQuery,
  ChannelDataQueryId,
  ChannelQuery,
  ChannelQueryId,
  CalculatedChannelDataQuery,
  QueryType,
  QueryTypes,
} from '../../types';
import { SiftDataSource } from '../../datasource';
import { Section } from '../common/Section';
import { InlineLabel, useStyles2 } from '@grafana/ui';
import { SelectableTypeInput } from '../input/SelectableTypeInput';
import { AddButton, RemoveButton, CopyButton } from '../common/InlineButton';
import { getStyles } from '../common/Common.style';
import { TextAreaInput } from '../input/TextAreaInput';
import {
  getValueAndSelectionTypeFromQuery,
  assetQueryFromSelection,
  runQueryFromSelection,
  insertAfter,
  deleteValue,
  assetToSelectableValue,
  runToSelectableValue,
  fillInDefaultChannelQueries,
  getSelectedAssetIds,
} from '../../utils';
import { SelectableInputTypes, SelectableInputType, SelectableInputTypeValue } from '../input/InputTypeSelect';
import { ChannelQueryEditor } from './ChannelQueryEditor';
import { nanoid } from 'nanoid';
import { useFetchAssets, useFetchRuns, useSiftAssetVariables } from '../../resources.hooks';
import { SelectableValue } from '@grafana/data';
import { DEFAULT_ASSET_QUERY, DEFAULT_CHANNEL_QUERY, DEFAULT_RUN_QUERY } from '../../constants';
import { ExpandableTextInput } from '../input/ExpandableTextInput';

const assetSelectableTypes: SelectableInputTypeValue[] = [
  {
    value: SelectableInputTypes.SELECT,
    label: 'Select',
    description: 'Select an Asset from a list',
    placeholderText: 'Select an Asset',
  },
  {
    value: SelectableInputTypes.TEXT,
    label: 'Text',
    description: 'Select an Asset by name (exact)',
    placeholderText: 'Enter an Asset Name',
  },
  {
    value: SelectableInputTypes.ID,
    label: 'ID',
    description: 'Select an Asset by ID',
    placeholderText: 'Enter an Asset ID',
  },
  {
    value: SelectableInputTypes.REGEX,
    label: 'Regex',
    description: 'Select Asset(s) by Regular Expression',
    placeholderText: 'Enter an Asset Regex',
  },
  {
    value: SelectableInputTypes.DASHBOARD,
    label: 'Dashboard Variables',
    description: 'Select Asset(s) by Dashboard Variable',
    placeholderText: 'Select a Dashboard Variable',
  },
];

interface Props {
  datasource: SiftDataSource;
  queryType: QueryType;
  channelDataQueryId: string;
  channelDataQuery: ChannelDataQuery;
  onUpdateQuery: (newQuery: ChannelDataQuery, queryId: ChannelDataQueryId) => void;
  removeQuery: (queryId: ChannelDataQueryId) => void;
  addQuery: (afterQueryId: ChannelDataQueryId) => void;
  cloneQuery: (queryId: ChannelDataQueryId) => void;
  canRemove: boolean;
}

export const SubQueryEditor = ({
  datasource,
  queryType,
  channelDataQueryId,
  channelDataQuery,
  onUpdateQuery,
  removeQuery,
  addQuery,
  cloneQuery,
  canRemove,
}: Props) => {
  const styles = useStyles2(getStyles);
  const { assets, loading: isAssetsLoading, loadAssets } = useFetchAssets(datasource);
  const { runs, loading: isRunsLoading, loadRuns } = useFetchRuns(datasource);
  const templateVariables = useSiftAssetVariables();

  // Asset
  const [initialAssetValue, initialAssetSelectType] = getValueAndSelectionTypeFromQuery(
    channelDataQuery.assetQueries && channelDataQuery.assetQueries.length
      ? channelDataQuery.assetQueries[0]
      : DEFAULT_ASSET_QUERY
  );
  const [selectedAssetValue, setSelectedAssetValue] = useState<string>(initialAssetValue);
  const [selectedAssetType, setSelectedAssetType] = useState<SelectableInputType>(initialAssetSelectType);
  const onUpdateAsset = useCallback(
    (value: string | SelectableValue<string> | undefined, type: SelectableInputType) => {
      if (typeof value === 'string') {
        setSelectedAssetValue(value);
        onUpdateQuery(
          {
            assetQueries: [assetQueryFromSelection(value, type)],
          },
          channelDataQueryId
        );
      } else {
        setSelectedAssetValue(value?.value || '');
        if (type === SelectableInputTypes.DASHBOARD) {
          onUpdateQuery(
            {
              assetQueries: [{ dashboardVariableName: value?.value }],
            },
            channelDataQueryId
          );
        } else {
          onUpdateQuery(
            {
              assetQueries: [{ assetId: value?.value, assetName: value?.label, asSelect: true }],
            },
            channelDataQueryId
          );
        }
      }
    },
    [channelDataQueryId, onUpdateQuery]
  );

  const [assetFilter, setAssetFilter] = useState<string>('');
  const selectedAssetIds = useMemo(() => {
    if (selectedAssetType === SelectableInputTypes.SELECT && selectedAssetValue) {
      return [selectedAssetValue];
    } else if (selectedAssetType === SelectableInputTypes.DASHBOARD && selectedAssetValue) {
      // If using a dashboard variable, get asset IDs so the other selections can be populated
      const grafanaVariable = templateVariables.find(
        (v) => `\$\{${v.name}\}` === selectedAssetValue || v.name === selectedAssetValue
      );
      if (grafanaVariable) {
        return getSelectedAssetIds(grafanaVariable);
      }
    } else if (selectedAssetType === SelectableInputTypes.ID && selectedAssetValue) {
      return [selectedAssetValue];
    }
    return [];
  }, [selectedAssetType, selectedAssetValue, templateVariables]);
  const onSelectAssetsFilter = useCallback(
    (searchTerm: string) => {
      if (searchTerm !== assetFilter) {
        setAssetFilter(searchTerm);
        void loadAssets(searchTerm, selectedAssetIds || undefined);
      }
    },
    [assetFilter, loadAssets, selectedAssetIds]
  );
  useEffect(() => {
    if (selectedAssetType === SelectableInputTypes.SELECT) {
      void loadAssets('', selectedAssetIds);
    }
  }, [selectedAssetType, selectedAssetIds, loadAssets]);

  const explicitAssetSelectionMode = useMemo(() => {
    return [SelectableInputTypes.SELECT, SelectableInputTypes.DASHBOARD, SelectableInputTypes.ID].includes(
      selectedAssetType
    );
  }, [selectedAssetType]);

  // Run
  const [initialRunValue, initialRunSelectType] = getValueAndSelectionTypeFromQuery(
    channelDataQuery.runQueries && channelDataQuery.runQueries.length
      ? channelDataQuery.runQueries[0]
      : DEFAULT_RUN_QUERY
  );
  const [selectedRunValue, setSelectedRunValue] = useState<string>(initialRunValue);
  const [selectedRunType, setSelectedRunType] = useState<SelectableInputType>(initialRunSelectType);
  const onUpdateRun = useCallback(
    (value: string | SelectableValue<string> | undefined, type: SelectableInputType) => {
      if (typeof value === 'string') {
        setSelectedRunValue(value);
        onUpdateQuery(
          {
            runQueries: [runQueryFromSelection(value, type)],
          },
          channelDataQueryId
        );
      } else {
        setSelectedRunValue(value?.value || '');
        onUpdateQuery(
          {
            runQueries: [{ runId: value?.value, runName: value?.label, asSelect: true }],
          },
          channelDataQueryId
        );
      }
    },
    [channelDataQueryId, onUpdateQuery]
  );

  const [runFilter, setRunFilter] = useState<string>('');
  const selectedRunIds = useMemo(
    () => (selectedRunType === SelectableInputTypes.SELECT && selectedRunValue ? [selectedRunValue] : []),
    [selectedRunType, selectedRunValue]
  );
  const onSelectRunsFilter = useCallback(
    (searchTerm: string) => {
      if (searchTerm !== runFilter) {
        setRunFilter(searchTerm);
        void loadRuns(selectedAssetIds, searchTerm, selectedAssetIds || undefined);
      }
    },
    [runFilter, loadRuns, selectedAssetIds]
  );
  useEffect(() => {
    if (selectedRunType === SelectableInputTypes.SELECT) {
      if (explicitAssetSelectionMode) {
        void loadRuns(selectedAssetIds, undefined, selectedRunIds || undefined);
      } else {
        setSelectedRunType(SelectableInputTypes.TEXT);
        onUpdateRun('', SelectableInputTypes.TEXT);
      }
    }
  }, [selectedRunType, selectedAssetIds, selectedRunIds, loadRuns, explicitAssetSelectionMode, onUpdateRun]);

  // If selected AssetIds change, need to update selection
  const lastSelectedAssetIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (lastSelectedAssetIdsRef.current !== selectedAssetIds) {
      setSelectedRunValue('');
      lastSelectedAssetIdsRef.current = selectedAssetIds;
    }
  }, [selectedAssetIds]);

  // Channels
  const [channelQueryMap, setChannelQueryMap] = useState<Map<ChannelQueryId, ChannelQuery>>(
    new Map(fillInDefaultChannelQueries(queryType, channelDataQuery).map((query) => [nanoid(), query]))
  );

  const [channelQueryOrder, setChannelQueryOrder] = useState<ChannelDataQueryId[]>(Array.from(channelQueryMap.keys()));

  const orderedChannelQueryMap = useMemo(
    () =>
      channelQueryOrder.reduce((map, key) => {
        map.set(key, channelQueryMap.get(key)!);
        return map;
      }, new Map<ChannelQueryId, ChannelQuery>()),
    [channelQueryMap, channelQueryOrder]
  );

  const addChannelQuery = useCallback(
    (afterQueryId: ChannelQueryId) => {
      const newQueryId = nanoid();
      setChannelQueryOrder(insertAfter(channelQueryOrder, afterQueryId, newQueryId));
      const newChannelQueryMap = new Map(channelQueryMap);
      newChannelQueryMap.set(newQueryId, DEFAULT_CHANNEL_QUERY);
      setChannelQueryMap(newChannelQueryMap);
    },
    [channelQueryMap, channelQueryOrder]
  );

  const removeChannelQuery = useCallback(
    (queryId: ChannelQueryId) => {
      setChannelQueryOrder(deleteValue(channelQueryOrder, queryId));
      const newChannelQueryMap = new Map(channelQueryMap);
      newChannelQueryMap.delete(queryId);
      setChannelQueryMap(newChannelQueryMap);
    },
    [channelQueryMap, channelQueryOrder]
  );

  const onUpdateChannelQuery = useCallback(
    (newQuery: ChannelQuery, queryId: ChannelQueryId) => {
      const newChannelQueryMap = new Map(channelQueryMap);
      newChannelQueryMap.set(queryId, newQuery);
      setChannelQueryMap(newChannelQueryMap);
    },
    [channelQueryMap]
  );

  // Calculated Channel
  const [calculatedChannelName, setCalculatedChannelName] = useState<string>(
    channelDataQuery?.calculatedChannelQueries?.[0]?.name || ''
  );
  const calculatedChannelNameRef = useRef(calculatedChannelName);
  const [calculatedChannelExpression, setCalculatedChannelExpression] = useState<string>(
    channelDataQuery?.calculatedChannelQueries?.[0]?.expression || ''
  );
  const calculatedChannelExpressionRef = useRef(calculatedChannelExpression);
  useEffect(() => {
    calculatedChannelNameRef.current = calculatedChannelName;
    calculatedChannelExpressionRef.current = calculatedChannelExpression;
  }, [calculatedChannelName, calculatedChannelExpression]);

  const performUpdate = useCallback(
    (channelQueries: ChannelQuery[]) => {
      if (queryType === QueryTypes.CALCULATED_CHANNEL) {
        const calculatedChannelQuery: CalculatedChannelDataQuery = {
          name: calculatedChannelNameRef.current,
          expression: calculatedChannelExpressionRef.current,
          channelReferences: channelQueries.map((c, index) => ({
            ...c,
            channelReference: `\$${index + 1}`,
          })),
        };
        onUpdateQuery({ calculatedChannelQueries: [calculatedChannelQuery], channelQueries: [] }, channelDataQueryId);
      } else {
        onUpdateQuery({ channelQueries, calculatedChannelQueries: [] }, channelDataQueryId);
      }
    },
    [channelDataQueryId, onUpdateQuery, queryType]
  );

  const updateChannelQuery = useCallback(() => {
    performUpdate(Array.from(orderedChannelQueryMap.values()));
  }, [orderedChannelQueryMap, performUpdate]);

  useEffect(() => {
    updateChannelQuery();
  }, [orderedChannelQueryMap, performUpdate, queryType, updateChannelQuery]);

  const runSelectableTypes: SelectableInputTypeValue[] = useMemo(
    () => [
      {
        value: SelectableInputTypes.SELECT,
        label: 'Select',
        description: 'Select a Run from a list',
        placeholderText: 'Select a Run to Filter',
        isDisabled: !explicitAssetSelectionMode,
      },
      {
        value: SelectableInputTypes.TEXT,
        label: 'Text',
        description: 'Select a Run by name (exact)',
        placeholderText: 'Filter by Run Name',
      },
      {
        value: SelectableInputTypes.ID,
        label: 'ID',
        description: 'Select a Run by ID or Client Key',
        placeholderText: 'Filter by Run ID or Client Key',
      },
      {
        value: SelectableInputTypes.REGEX,
        label: 'Regex',
        description: 'Select Run(s) by Regular Expression',
        placeholderText: 'Filter by Run Regex',
      },
    ],
    [explicitAssetSelectionMode]
  );

  return (
    <>
      {queryType === QueryTypes.CALCULATED_CHANNEL && (
        <Section label={'NAME'}>
          <ExpandableTextInput
            value={calculatedChannelName}
            onChange={setCalculatedChannelName}
            onBlur={updateChannelQuery}
            placeholder="Enter a calculation name"
          />
          <RemoveButton
            disabled={!canRemove}
            onClick={() => removeQuery(channelDataQueryId)}
            tooltip="Remove Calculation subquery"
            disabledTooltip="Cannot remove only Calculation subquery"
          />
          <CopyButton tooltip="Clone Calculation subquery" onClick={() => cloneQuery(channelDataQueryId)} />
          <AddButton onClick={() => addQuery(channelDataQueryId)} tooltip="Insert Calculation subquery" />
        </Section>
      )}
      <Section label={'SELECT'}>
        <InlineLabel width="auto" className={styles.inlineLabel}>
          Asset
        </InlineLabel>
        <SelectableTypeInput
          value={selectedAssetValue}
          onUpdate={onUpdateAsset}
          selectableValues={
            selectedAssetType === SelectableInputTypes.DASHBOARD
              ? templateVariables.map((v) => ({
                  label: `\$${v.name}`,
                  value: `\$\{${v.name}\}`,
                  description: v.label,
                }))
              : assets.map((asset) => assetToSelectableValue(asset))
          }
          selectedType={selectedAssetType}
          onSelectType={setSelectedAssetType}
          selectableTypes={assetSelectableTypes}
          isLoading={isAssetsLoading}
          onSelectFilter={onSelectAssetsFilter}
          noOptionsMessage="No assets found"
        />
        <InlineLabel width="auto" className={styles.inlineLabel}>
          Run
        </InlineLabel>
        <SelectableTypeInput
          value={selectedRunValue}
          onUpdate={onUpdateRun}
          selectableValues={runs.map((run) => runToSelectableValue(run))}
          selectedType={selectedRunType}
          onSelectType={setSelectedRunType}
          selectableTypes={runSelectableTypes}
          isLoading={isRunsLoading}
          onSelectFilter={onSelectRunsFilter}
          noOptionsMessage={
            selectedAssetIds && selectedAssetIds.length ? 'No Runs found for selected Assets' : 'Select an Asset first'
          }
        />
        {queryType === QueryTypes.CHANNEL && (
          <>
            <RemoveButton
              disabled={!canRemove}
              onClick={() => removeQuery(channelDataQueryId)}
              tooltip="Remove Asset/Run subquery"
              disabledTooltip="Cannot remove only Asseet/Run subquery"
            />
            <CopyButton tooltip="Clone Asset/Run subquery" onClick={() => cloneQuery(channelDataQueryId)} />
            <AddButton onClick={() => addQuery(channelDataQueryId)} tooltip="Insert Asset/Run subquery" />
          </>
        )}
      </Section>
      {Array.from(orderedChannelQueryMap).map(([queryId, query], index) => (
        <ChannelQueryEditor
          key={`chanel-select-query-${queryId}`}
          datasource={datasource}
          queryType={queryType}
          channelIndex={index}
          channelQueryId={queryId}
          channelQuery={query}
          onUpdateQuery={onUpdateChannelQuery}
          addQuery={addChannelQuery}
          removeQuery={removeChannelQuery}
          canRemove={orderedChannelQueryMap.size > 1}
          selectedAssetIds={selectedAssetIds}
          selectEnabled={explicitAssetSelectionMode && selectedAssetIds.length < 2}
        />
      ))}
      {queryType === QueryTypes.CALCULATED_CHANNEL && (
        <Section label={'EXPRESSION'} flexibleHeight>
          <TextAreaInput
            value={calculatedChannelExpression}
            onChange={setCalculatedChannelExpression}
            onBlur={updateChannelQuery}
            placeholder="Enter an expression"
          />
        </Section>
      )}
    </>
  );
};
