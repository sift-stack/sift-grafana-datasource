import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ChannelQuery, ChannelQueryId, QueryType, QueryTypes } from '../../types';
import { SiftDataSource } from '../../datasource';
import { Section } from '../common/Section';
import { InlineLabel, useStyles2 } from '@grafana/ui';
import { SelectableTypeInput } from '../input/SelectableTypeInput';
import { AddButton, RemoveButton } from '../common/InlineButton';
import { getStyles } from '../common/Common.style';
import { getValueAndSelectionTypeFromQuery, channelQueryFromSelection, channelToSelectableValue } from '../../utils';
import { SelectableInputTypes, SelectableInputType, SelectableInputTypeValue } from '../input/InputTypeSelect';
import { useFetchChannels } from '../../resources.hooks';
import { SelectableValue } from '@grafana/data';

interface Props {
  datasource: SiftDataSource;
  queryType: QueryType;
  channelIndex: number;
  channelQueryId: string;
  channelQuery: ChannelQuery;
  onUpdateQuery: (newQuery: ChannelQuery, queryId: ChannelQueryId) => void;
  removeQuery: (queryId: ChannelQueryId) => void;
  addQuery: (afterQueryId: ChannelQueryId) => void;
  canRemove: boolean;
  selectedAssetIds: string[];
  selectEnabled: boolean;
}

export const ChannelQueryEditor = ({
  datasource,
  queryType,
  channelIndex,
  channelQueryId,
  channelQuery,
  onUpdateQuery,
  removeQuery,
  addQuery,
  canRemove,
  selectedAssetIds,
  selectEnabled,
}: Props) => {
  const styles = useStyles2(getStyles);
  const { channels, loading: isChannelsLoading, loadChannels } = useFetchChannels(datasource);
  // Channel
  const [selectedChannelValue, setSelectedChannelValue] = useState<string>('');
  const [selectedChannelType, setSelectedChannelType] = useState<SelectableInputType>(SelectableInputTypes.TEXT);

  useEffect(() => {
    const [value, type] = getValueAndSelectionTypeFromQuery(channelQuery);
    setSelectedChannelValue(value);
    setSelectedChannelType(type);
    console.log('channelQueryChanged', channelQuery, value, type);
  }, [channelQuery]);

  const onUpdateChannel = useCallback(
    (value: string | SelectableValue<string> | undefined, type: SelectableInputType) => {
      if (typeof value === 'string') {
        setSelectedChannelValue(value);
        onUpdateQuery(channelQueryFromSelection(value, type), channelQueryId);
      } else {
        setSelectedChannelValue(value?.value || '');
        onUpdateQuery({ channelName: value?.label, asSelect: true }, channelQueryId);
      }
    },
    [channelQueryId, onUpdateQuery]
  );

  // Ensures that when select is disabled the type is switched to text
  useEffect(() => {
    if (!selectEnabled && selectedChannelType === SelectableInputTypes.SELECT) {
      setSelectedChannelType(SelectableInputTypes.TEXT);
      onUpdateChannel('', SelectableInputTypes.TEXT);
    }
  }, [onUpdateChannel, selectEnabled, selectedChannelType]);

  const [channelFilter, setChannelFilter] = useState<string>('');
  const selectedChannelNames = useMemo(
    () => (selectedChannelType === SelectableInputTypes.SELECT && selectedChannelValue ? [selectedChannelValue] : []),
    [selectedChannelType, selectedChannelValue]
  );
  const onSelectChannelsFilter = useCallback(
    (searchTerm: string) => {
      if (searchTerm !== channelFilter) {
        setChannelFilter(searchTerm);
        void loadChannels(selectedAssetIds, searchTerm, selectedChannelNames || undefined);
      }
    },
    [channelFilter, loadChannels, selectedAssetIds, selectedChannelNames]
  );

  useEffect(() => {
    if (selectedChannelType === SelectableInputTypes.SELECT) {
      void loadChannels(selectedAssetIds, undefined, selectedChannelNames || undefined);
    }
  }, [selectedChannelType, selectedAssetIds, selectedChannelNames, loadChannels]);

  const channelSelectableTypes = useMemo(
    () => [
      {
        value: SelectableInputTypes.SELECT,
        label: 'Select',
        description: 'Select a Channel from a list',
        placeholderText: 'Select a Channel',
        isDisabled: !selectEnabled,
      },
      {
        value: SelectableInputTypes.TEXT,
        label: 'Text',
        description: 'Select a Channel by name (exact)',
        placeholderText: 'Enter a Channel Name',
      },
      {
        value: SelectableInputTypes.ID,
        label: 'ID',
        description: 'Select a Channel by ID',
        placeholderText: 'Enter a Channel ID',
      },
      {
        value: SelectableInputTypes.REGEX,
        label: 'Regex',
        description: 'Select Channel(s) by Regular Expression',
        placeholderText: 'Enter a Channel Regex',
      },
    ],
    [selectEnabled]
  );

  return (
    <Section label={channelIndex === 0 ? 'CHANNEL' : ''}>
      {queryType === QueryTypes.CALCULATED_CHANNEL && (
        <InlineLabel width="auto" className={styles.inlineLabel}>
          {`\$${channelIndex + 1}`}
        </InlineLabel>
      )}
      <SelectableTypeInput
        value={selectedChannelValue}
        onUpdate={onUpdateChannel}
        selectableValues={channels.map((channel) => channelToSelectableValue(channel))}
        selectedType={selectedChannelType}
        onSelectType={setSelectedChannelType}
        selectableTypes={channelSelectableTypes}
        isLoading={isChannelsLoading}
        onSelectFilter={onSelectChannelsFilter}
        noOptionsMessage={selectedAssetIds && selectedAssetIds.length ? 'No Channels found' : 'Select an Asset first'}
      />
      <RemoveButton
        disabled={!canRemove}
        onClick={() => removeQuery(channelQueryId)}
        tooltip="Remove Channel"
        disabledTooltip="Cannot remove only Channel query"
      />
      <AddButton onClick={() => addQuery(channelQueryId)} tooltip="Insert Channel" />
    </Section>
  );
};
