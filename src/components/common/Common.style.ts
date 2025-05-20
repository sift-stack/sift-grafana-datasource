import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const commonSegmentStyle = css({
  marginRight: '4px',
});

export const commonInputStyle = css({
  minWidth: '240px',
});

export const getStyles = (theme: GrafanaTheme2) => ({
  iconButton: css({
    paddingLeft: theme.spacing(0.5),
    paddingRight: theme.spacing(0.5),
    minWidth: 26,
    width: 'auto',
    justifyContent: 'center',
  }),
  inlineLabel: css({
    minWidth: 32,
  }),
  inlineButtonBlue: css({
    color: theme.colors.primary.text,
  }),
  inlineButtonDisabled: css({
    color: theme.colors.text.disabled,
    cursor: 'not-allowed',
  }),
  sectionGrouperBar: css({
    borderColor: theme.colors.border.medium,
  }),
});
