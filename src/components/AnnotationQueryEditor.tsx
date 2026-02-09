import React, { useCallback, useEffect, useState } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, InlineLabel, RadioButtonGroup } from '@grafana/ui';
import { SiftDataSource } from '../datasource';
import { AnnotationQueryType, SiftQuery, SiftDataSourceOptions } from '../types';
import { VisualSiftQueryEditor } from './VisualSiftQueryEditor';

type Props = QueryEditorProps<SiftDataSource, SiftQuery, SiftDataSourceOptions>;

const ANNOTATION_QUERY_TYPES: Array<{ label: string; value: AnnotationQueryType; description: string }> = [
  {
    label: 'Data Query',
    value: 'dataQuery',
    description: 'Use channel data as annotations',
  },
  {
    label: 'Sift Annotations',
    value: 'annotationsQuery',
    description: 'Query Sift annotations API (coming soon)',
  },
];

export const AnnotationQueryEditor = (props: Props) => {
  const { query, onChange, onRunQuery } = props;
  const [annotationType, setAnnotationType] = useState<AnnotationQueryType>('dataQuery');
  const [initialized, setInitialized] = useState(false);

  // Initialize once - set annotationType if not present
  useEffect(() => {
    if (initialized) {
      return;
    }

    const initAnnotationType = query.annotationType || 'dataQuery';
    setAnnotationType(initAnnotationType);

    // Ensure query has annotationType set
    if (!query.annotationType) {
      onChange({
        ...query,
        annotationType: initAnnotationType,
      });
    }

    setInitialized(true);
  }, [query, onChange, initialized]);

  const onAnnotationTypeChange = useCallback(
    (newAnnotationType: AnnotationQueryType) => {
      setAnnotationType(newAnnotationType);
      onChange({
        ...query,
        annotationType: newAnnotationType,
      });
      onRunQuery();
    },
    [query, onChange, onRunQuery]
  );

  // Wrap onChange to always include annotationType
  const onChangeWithAnnotationType = useCallback(
    (updatedQuery: SiftQuery) => {
      onChange({
        ...updatedQuery,
        annotationType,
      });
    },
    [onChange, annotationType]
  );

  if (!initialized) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <InlineFieldRow>
        <InlineField label="Annotation Source" labelWidth={16}>
          <RadioButtonGroup value={annotationType} options={ANNOTATION_QUERY_TYPES} onChange={onAnnotationTypeChange} />
        </InlineField>
      </InlineFieldRow>

      {annotationType === 'dataQuery' && (
        <>
          <InlineFieldRow>
            <InlineLabel width="auto">
              Query channel data to use as annotations. Each data point becomes an annotation.
            </InlineLabel>
          </InlineFieldRow>
          <VisualSiftQueryEditor {...props} onChange={onChangeWithAnnotationType} />
        </>
      )}

      {annotationType === 'annotationsQuery' && (
        <InlineFieldRow>
          <InlineLabel width="auto">Sift Annotations API support coming soon.</InlineLabel>
        </InlineFieldRow>
      )}
    </div>
  );
};
