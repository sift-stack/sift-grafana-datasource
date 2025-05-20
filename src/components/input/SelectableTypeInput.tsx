import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ExpandableTextInput } from './ExpandableTextInput';
import {
  InputTypeSelect,
  SelectableInputType,
  SelectableInputTypes,
  SelectableInputTypeValue,
} from './InputTypeSelect';
import { Select } from '@grafana/ui';
import { commonInputStyle, commonSegmentStyle } from '../common/Common.style';
import { cx } from '@emotion/css';
import { SelectableValue } from '@grafana/data';
import { regexEscape } from '../../utils';

interface Props {
  value: string;
  onUpdate: (value: string | SelectableValue<string> | undefined, type: SelectableInputType) => void;
  onSelectFilter: (value: string) => void;
  selectableValues?: Array<SelectableValue<string>>;
  onSelectType: (type: SelectableInputType) => void;
  selectedType: SelectableInputType;
  selectableTypes: SelectableInputTypeValue[];
  isLoading?: boolean;
  noOptionsMessage?: string;
}

// Convert a selection option to a text value
const selectedOptionToText = (
  selectedOption: SelectableValue<string> | undefined,
  newType: SelectableInputType,
  prevType: SelectableInputType
): string => {
  if (newType === SelectableInputTypes.ID) {
    return selectedOption?.value || '';
  } else if (newType === SelectableInputTypes.REGEX) {
    if (prevType === SelectableInputTypes.DASHBOARD) {
      return '';
    }
    return (selectedOption?.label && `^${regexEscape(selectedOption?.label)}$`) || '';
  } else {
    if (prevType === SelectableInputTypes.DASHBOARD) {
      return '';
    }
    return selectedOption?.label || '';
  }
};

export const SelectableTypeInput = ({
  value,
  onUpdate,
  selectableValues,
  onSelectType,
  selectedType,
  selectableTypes,
  isLoading,
  onSelectFilter,
  noOptionsMessage,
}: Props) => {
  const [selectedValue, setSelectedValue] = useState<string | undefined>(undefined);
  const [dashboardSelectedValue, setDashboardSelectedValue] = useState<string | undefined>(undefined);
  const [selectedText, setSelectedText] = useState<string>('');

  const selectedOption = useMemo(() => {
    if (selectedType === SelectableInputTypes.SELECT) {
      return selectableValues?.find((v) => v.value === selectedValue);
    } else if (selectedType === SelectableInputTypes.DASHBOARD) {
      return selectableValues?.find((v) => v.value === dashboardSelectedValue);
    } else {
      return undefined;
    }
  }, [dashboardSelectedValue, selectableValues, selectedValue, selectedType]);

  const selectedTypeRef = React.useRef(selectedType);
  useEffect(() => {
    selectedTypeRef.current = selectedType;
  }, [selectedType]);

  useEffect(() => {
    if (selectedTypeRef.current === SelectableInputTypes.SELECT) {
      setSelectedValue(value ?? undefined);
    } else if (selectedTypeRef.current === SelectableInputTypes.DASHBOARD) {
      setDashboardSelectedValue(value ?? undefined);
    } else {
      setSelectedText(value);
    }
  }, [value]);

  const selectSetter = useMemo(() => {
    return selectedType === SelectableInputTypes.DASHBOARD ? setDashboardSelectedValue : setSelectedValue;
  }, [selectedType]);

  const getCurrentValue = useCallback(
    (type: SelectableInputType) => {
      if (type === SelectableInputTypes.SELECT) {
        return selectableValues?.find((v) => v.value === selectedValue);
      } else if (type === SelectableInputTypes.DASHBOARD) {
        return selectableValues?.find((v) => v.value === dashboardSelectedValue);
      } else {
        return selectedText;
      }
    },
    [dashboardSelectedValue, selectableValues, selectedText, selectedValue]
  );

  const onChangeInputType = useCallback(
    (newType: SelectableInputType) => {
      if (newType === selectedType) {
        return;
      } else if (
        // if switching to a text type, update the text to the appropriate value depending on new input
        [SelectableInputTypes.ID, SelectableInputTypes.TEXT, SelectableInputTypes.REGEX].includes(newType) &&
        [SelectableInputTypes.SELECT, SelectableInputTypes.DASHBOARD].includes(selectedType)
      ) {
        const newValue = selectedOptionToText(selectedOption, newType, selectedType);
        onUpdate(newValue, newType);
        setSelectedText(newValue);
        // select value is maintained
      } else if (
        // If switching from text to a selection type, clear out the previous text
        [SelectableInputTypes.SELECT, SelectableInputTypes.DASHBOARD].includes(newType) &&
        [SelectableInputTypes.ID, SelectableInputTypes.TEXT, SelectableInputTypes.REGEX].includes(selectedType)
      ) {
        onUpdate(getCurrentValue(newType), newType);
        setSelectedText('');
      } else {
        onUpdate(getCurrentValue(newType), newType);
      }
      onSelectType(newType);
    },
    [getCurrentValue, onSelectType, onUpdate, selectedOption, selectedType]
  );

  // Update values on user input
  const onChange = useCallback((value: string) => setSelectedText(value), []);

  const setText = useCallback(
    (value: string) => {
      setSelectedText(value);
      onUpdate(value, selectedType);
    },
    [onUpdate, selectedType]
  );
  const setSelect = useCallback(
    (value: SelectableValue<string>) => {
      if (!value) {
        selectSetter(undefined);
        onUpdate(undefined, selectedType);
      } else {
        selectSetter(value.value);
        onUpdate(value, selectedType);
      }
    },
    [onUpdate, selectSetter, selectedType]
  );

  const placeholder = useMemo(() => {
    return selectableTypes.find((v) => v.value === selectedType)?.placeholderText;
  }, [selectedType, selectableTypes]);

  return (
    <>
      {selectedType === SelectableInputTypes.SELECT || selectedType === SelectableInputTypes.DASHBOARD ? (
        <div className={cx(commonInputStyle, commonSegmentStyle)}>
          {/* Two distinct selects since otherwise switching between them causes odd state issues with selected val.
            Select is used here instead of Combobox to keep backwards compatibility with Grafana v11.0.0*/}
          {selectedType === SelectableInputTypes.SELECT && (
            <Select
              key={selectedValue} // force re-mount otherwise when value becomes undefined, it is not truly cleared
              placeholder={placeholder}
              onChange={setSelect}
              options={selectableValues}
              value={selectedValue}
              isClearable
              isSearchable
              loadingMessage="Loading options..."
              isLoading={isLoading}
              onInputChange={onSelectFilter}
              noOptionsMessage={noOptionsMessage}
            />
          )}
          {selectedType === SelectableInputTypes.DASHBOARD && (
            <Select
              key={dashboardSelectedValue} // force re-mount otherwise when value becomes undefined, it is not truly cleared
              placeholder={placeholder}
              onChange={setSelect}
              options={selectableValues}
              value={dashboardSelectedValue}
              isClearable
              isSearchable
              loadingMessage="Loading options..."
              isLoading={isLoading}
              onInputChange={onSelectFilter}
              noOptionsMessage={noOptionsMessage}
            />
          )}
        </div>
      ) : (
        <ExpandableTextInput placeholder={placeholder} onBlur={setText} onChange={onChange} value={selectedText} />
      )}
      <InputTypeSelect selectedType={selectedType} onChange={onChangeInputType} inputTypes={selectableTypes} />
    </>
  );
};
