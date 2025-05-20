import { css, cx } from '@emotion/css';
import React, { useState, useRef, useEffect } from 'react';
import { InlineField, Input } from '@grafana/ui';
import { commonInputStyle, commonSegmentStyle } from '../common/Common.style';

const MIN_WIDTH = 240;

interface Props {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const ExpandableTextInput = (props: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.FormEvent<HTMLInputElement>) => {
    const newValue = e.currentTarget.value;

    // For auto resizing of width
    if (inputRef.current && inputRef.current.parentElement) {
      inputRef.current.parentElement.setAttribute('data-value', newValue);
    }

    if (props.onChange) {
      props.onChange(newValue);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (props.onBlur) {
      props.onBlur(e.currentTarget.value);
    }
  };

  useEffect(() => {
    if (inputRef.current && inputRef.current.parentElement) {
      inputRef.current.parentElement.setAttribute('data-value', props.value);
    }
  }, [props.value]);

  return (
    <InlineField className={cx(commonSegmentStyle, props.className, flexInputStyle)}>
      <div className="input-wrapper" data-value={props.value}>
        <Input
          value={props.value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={props.placeholder}
          className={cx('growing-input', props.className, commonInputStyle)}
          ref={inputRef as React.Ref<HTMLInputElement>}
        />
      </div>
    </InlineField>
  );
};

// Style for flex-based input that grows with content but respects container
const flexInputStyle = css`
  display: inline-block;
  flex: unset;

  /* Target the wrapper div that will have the data-value attribute */
  .input-wrapper {
    display: inline-grid;
    vertical-align: top;
    align-items: center;
    margin: 0;
    height: 32px;
  }

  /* Use the data-value attribute for sizing */
  .input-wrapper::after {
    content: attr(data-value) '  '; /* The space ensures there's always a little extra room */
    visibility: hidden;
    white-space: pre-wrap;
    padding: 0 2px;
    min-width: ${MIN_WIDTH}px;
  }

  input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: ${MIN_WIDTH}px;
    transition: width 0.2s ease;
  }
`;
