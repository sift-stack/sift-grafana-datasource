import { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow } from '@grafana/ui';

import { SiftDataSource } from '../datasource';

import { SiftVariableQuery, SiftDataSourceOptions, SiftQuery } from '../types';
import React, { useCallback, useEffect } from 'react';

export type Props = QueryEditorProps<SiftDataSource, SiftQuery, SiftDataSourceOptions, SiftVariableQuery>;

export const SiftVariableQueryEditor = ({}: Props) => {
  return (
    <InlineFieldRow>
      <InlineField label="Asset" tooltip={<div>Asset Dropdown</div>}>
        <div></div>
      </InlineField>
    </InlineFieldRow>
  );
};
