import { cx } from '@emotion/css';
import React from 'react';

import { InlineLabel, useStyles2, Icon, Tooltip, IconName } from '@grafana/ui';

import { getStyles, commonSegmentStyle } from './Common.style';

interface Props {
  iconName: IconName;
  tooltip: string;
  disabledTooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export const InlineIconButton = (props: Props) => {
  const styles = useStyles2(getStyles);

  // Inline label as button doesn't provide disabled functionality out of the box
  const handleClick = () => {
    if (props.disabled || !props.onClick) {
      return;
    }
    props.onClick();
  };

  return (
    <InlineLabel
      as="button"
      className={cx(
        styles.iconButton,
        commonSegmentStyle,
        props.className,
        props.disabled && styles.inlineButtonDisabled
      )}
      aria-label={props.ariaLabel || props.disabled ? props.tooltip + ' (disabled)' : props.tooltip}
      onClick={handleClick}
    >
      <Tooltip content={props.disabled ? props.disabledTooltip ?? props.tooltip : props.tooltip}>
        <Icon name={props.iconName} />
      </Tooltip>
    </InlineLabel>
  );
};

interface ButtonProps {
  tooltip: string;
  disabledTooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export const AddButton = (props: ButtonProps) => {
  const styles = useStyles2(getStyles);
  return <InlineIconButton {...props} iconName="plus" className={styles.inlineButtonBlue} />;
};

export const RemoveButton = (props: ButtonProps) => {
  const styles = useStyles2(getStyles);
  return <InlineIconButton {...props} iconName="times" />;
};

export const CopyButton = (props: ButtonProps) => {
  const styles = useStyles2(getStyles);
  return <InlineIconButton {...props} iconName="copy" />;
};
