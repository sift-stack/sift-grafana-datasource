import { css, cx } from '@emotion/css';
import React, { useRef, useEffect, useCallback } from 'react';
import { InlineField, TextArea } from '@grafana/ui';
import { commonInputStyle, commonSegmentStyle } from '../common/Common.style';

const MIN_HEIGHT = 32;

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const TextAreaInput = (props: Props) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = el.scrollHeight > el.clientHeight ? `${el.scrollHeight}px` : `${MIN_HEIGHT}px`;
  }, []);

  const handleChange = (e: React.FormEvent<HTMLTextAreaElement>) => {
    props.onChange?.(e.currentTarget.value);
    adjustHeight();
  };

  // Adjust height on mount and window resize
  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener('resize', handleResize);

    // Initial adjustment after render
    setTimeout(adjustHeight, 0);

    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  return (
    <InlineField className={cx(commonSegmentStyle, containerStyles)}>
      <TextArea
        value={props.value}
        onChange={handleChange}
        onBlur={(e) => props.onBlur?.(e.currentTarget.value)}
        onKeyUp={() => adjustHeight()}
        placeholder={props.placeholder}
        className={cx(inputStyles, commonInputStyle, props.className)}
        ref={textareaRef}
      />
    </InlineField>
  );
};

const containerStyles = css`
  flex-grow: 1000;
  > div {
    width: 100%;
  }
`;

const inputStyles = css`
  width: 100%;
  min-height: ${MIN_HEIGHT}px;
  overflow-y: hidden;
  word-wrap: break-word;
  /* Hide scrollbar */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  /* disable user resizing */
  resize: none;
`;
