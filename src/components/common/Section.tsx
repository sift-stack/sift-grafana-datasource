import { cx, css } from '@emotion/css';
import React from 'react';

import { SegmentSection } from '@grafana/ui';

export interface SectionProps {
  label: string;
  children?: React.ReactNode;
  flexibleHeight?: boolean;
  disableFill?: boolean;
}

export const Section = (props: SectionProps) => {
  return (
    <div className={cx(noWrapStyle(props))}>
      <SegmentSection label={props.label} fill={!props.disableFill}>
        {props.children}
      </SegmentSection>
    </div>
  );
};

const noWrapStyle = (props: SectionProps) => css`
  /* prevent expandable text input from wrapping */
  > div {
    flex-flow: nowrap !important;
  }
  > div > div:last-child {
    min-width: 24px;
    > label {
      width: 100%;
      padding: 0;
      /* Allow for textarea to expand vertically */
      ${props.flexibleHeight ? 'height: 100%;' : ''}
    }
  }
`;
