import { cx } from '@emotion/css';
import React, { useMemo } from 'react';

import { Button, useStyles2, Icon, Dropdown, Menu } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { RegexIcon, SelectIcon } from '../common/CustomIcons';
import { getStyles, commonSegmentStyle } from '../common/Common.style';

export const SelectableInputTypes = {
  SELECT: 'select',
  TEXT: 'text',
  REGEX: 'regex',
  ID: 'id',
  DASHBOARD: 'dashboard',
};

export type SelectableInputType = (typeof SelectableInputTypes)[keyof typeof SelectableInputTypes];

interface InputTypeIconsMap {
  [key: SelectableInputType]: React.ReactNode;
}

const inputTypeIcons: InputTypeIconsMap = {
  [SelectableInputTypes.SELECT]: <SelectIcon data-testid="select-icon" />,
  [SelectableInputTypes.TEXT]: <Icon name="text-fields" />,
  [SelectableInputTypes.REGEX]: <RegexIcon data-testid="regex-icon" />,
  [SelectableInputTypes.ID]: <Icon name="key-skeleton-alt" />,
  [SelectableInputTypes.DASHBOARD]: <Icon name="dashboard" />,
};

export type SelectableInputTypeValue = SelectableValue<SelectableInputType> & {
  placeholderText: string;
};

interface Props {
  onChange: (value: SelectableInputType) => void;
  selectedType: SelectableInputType;
  inputTypes: SelectableInputTypeValue[];
}

export const InputTypeSelect = ({ onChange, selectedType, inputTypes }: Props) => {
  const styles = useStyles2(getStyles);

  const currentType = useMemo(() => inputTypes.find((type) => type.value === selectedType), [inputTypes, selectedType]);

  const menu = (
    <Menu>
      {inputTypes.map((type) => (
        <Menu.Item
          key={`select-input-type-${type.value}`}
          label={type.label ?? ''}
          description={type.description}
          onClick={() => onChange(type.value ?? SelectableInputTypes.SELECT)}
          active={type.value === selectedType}
          disabled={type.isDisabled}
        />
      ))}
    </Menu>
  );

  return (
    <Dropdown overlay={menu} placement="bottom-start">
      <Button
        tooltip="Change input type"
        aria-label={`Change input type (currently ${currentType?.label})`}
        variant="secondary"
        className={cx(styles.iconButton, commonSegmentStyle)}
      >
        {inputTypeIcons[selectedType]}
      </Button>
    </Dropdown>
  );
};
