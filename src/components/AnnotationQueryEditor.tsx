import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, QueryEditorProps } from '@grafana/data';
import { Icon, InlineField, InlineFieldRow, Input, RadioButtonGroup, Text, TextLink, useStyles2 } from '@grafana/ui';
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
    description: 'Query Sift annotations from the Sift API',
  },
];

const getStyles = (theme: GrafanaTheme2) => ({
  description: css({
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(1),
  }),
  docsContent: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  examplesList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    listStyleType: 'disc',
  }),
  docsSection: css({
    marginTop: theme.spacing(0.5),
  }),
  docsToggle: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),
});

const AnnotationFilterDocs = () => {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.docsSection}>
      <button className={styles.docsToggle} onClick={() => setIsOpen(!isOpen)} type="button">
        <Icon name={isOpen ? 'angle-down' : 'angle-right'} size="sm" />
        Filter help &amp; examples
      </button>
      {isOpen && (
        <div className={styles.docsContent}>
          <Text variant="bodySmall" color="secondary">
            Use{' '}
            <TextLink href="https://cel.dev/" external inline variant="bodySmall">
              CEL (Common Expression Language)
            </TextLink>{' '}
            to filter annotations. Grafana dashboard variables are supported.
          </Text>
          <Text variant="bodySmall" color="secondary">
            <strong>Available fields:</strong> asset_id, asset_name, name, state, annotation_type, etc. See Sift docs
            for full list.
          </Text>
          <Text variant="bodySmall" color="secondary">
            <strong>Examples:</strong>
          </Text>
          <ul className={styles.examplesList}>
            <li>
              <Text variant="bodySmall">
                <code>asset_name == &apos;my_asset&apos;</code>
              </Text>
            </li>
            <li>
              <Text variant="bodySmall">
                <code>asset_id == &apos;{'${assetQuery}'}&apos;</code> (using a dashboard variable)
              </Text>
            </li>
            <li>
              <Text variant="bodySmall">
                <code>
                  annotation_type == &apos;ANNOTATION_TYPE_PHASE&apos; && state == &apos;ANNOTATION_STATE_OPEN&apos;
                </code>
              </Text>
            </li>
          </ul>
          <Text variant="bodySmall" color="secondary">
            For full documentation, see the{' '}
            <TextLink href="https://docs.siftstack.com" external inline variant="bodySmall">
              Sift documentation
            </TextLink>
            .
          </Text>
        </div>
      )}
    </div>
  );
};

export const AnnotationQueryEditor = (props: Props) => {
  const { query, onChange, onRunQuery } = props;
  const [annotationType, setAnnotationType] = useState<AnnotationQueryType>('annotationsQuery');
  const [annotationFilter, setAnnotationFilter] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Initialize once - set annotationType if not present
  useEffect(() => {
    if (initialized) {
      return;
    }

    const initAnnotationType = query.annotationType || 'annotationsQuery';
    setAnnotationType(initAnnotationType);
    setAnnotationFilter(query.annotationFilter || '');

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

  const onAnnotationFilterChange = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    setAnnotationFilter(e.currentTarget.value);
  }, []);

  const onAnnotationFilterBlur = useCallback(() => {
    onChange({
      ...query,
      annotationType,
      annotationFilter,
    });
    onRunQuery();
  }, [query, onChange, onRunQuery, annotationType, annotationFilter]);

  const styles = useStyles2(getStyles);

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
          <div className={styles.description}>
            <Text variant="bodySmall" color="secondary">
              Query channel data to use as annotations. Each data point becomes an annotation.
            </Text>
          </div>
          <VisualSiftQueryEditor {...props} onChange={onChangeWithAnnotationType} />
        </>
      )}

      {annotationType === 'annotationsQuery' && (
        <>
          <div className={styles.description}>
            <Text variant="bodySmall" color="secondary">
              Query Sift Annotations from the Sift API. Time range is applied automatically.
            </Text>
          </div>
          <InlineFieldRow>
            <InlineField label="Filter (CEL)" labelWidth={12} grow>
              <Input
                value={annotationFilter}
                onChange={onAnnotationFilterChange}
                onBlur={onAnnotationFilterBlur}
                placeholder="example: asset_name == 'rover_1'"
              />
            </InlineField>
          </InlineFieldRow>
          <AnnotationFilterDocs />
        </>
      )}
    </div>
  );
};
