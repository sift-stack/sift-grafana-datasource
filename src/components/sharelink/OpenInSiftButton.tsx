import React, { useMemo } from 'react';
import { Button, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { getFrontendHostnameDefaults } from './getFrontendHostnameDefaults';
import { generateLinkFromQuery } from './generateLinkFromQuery';
import { QueryTypes, type QueryType, type SharelinkItems, type SharelinkTimeRange } from '../../types';
import { SquareShareIcon } from '../common/CustomIcons';

interface SharelinkMenuItemProps {
  items?: SharelinkItems;
  className?: string;
  apiBaseUrl?: string;
  frontendUrl?: string;
  timeRange?: SharelinkTimeRange;
  queryType?: QueryType;
}

function openLink(link: string) {
  window.open(link, '_blank', 'noopener,noreferrer');
}

function publishAlert(type: string, message: string) {
  const appEvents = getAppEvents();
  if (appEvents) {
    appEvents.publish({
      type,
      payload: [message],
    });
  }
}

async function copyToClipboard(value: string) {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('Clipboard API not available');
  }

  await navigator.clipboard.writeText(value);
}

export const OpenInSiftButton = ({
  className,
  items,
  apiBaseUrl,
  frontendUrl,
  timeRange,
  queryType,
}: SharelinkMenuItemProps) => {
  const { shareLink, disabledReason } = useMemo(() => {
    const trimmedFrontendUrl = frontendUrl?.trim();

    if (queryType === QueryTypes.CALCULATED_CHANNEL) {
      return {
        shareLink: null,
        disabledReason: 'Open in Sift is unavailable when Query Mode is set to Calculated Channels',
      };
    }

    if (!apiBaseUrl && !trimmedFrontendUrl) {
      return {
        shareLink: null,
        disabledReason: 'Configure the Sift API REST URL to enable share links',
      };
    }

    if (!items || items.channelIds.length === 0) {
      return {
        shareLink: null,
        disabledReason: 'Select a channel to enable share links',
      };
    }

    const hostname = trimmedFrontendUrl || getFrontendHostnameDefaults(apiBaseUrl ?? '');
    if (!hostname) {
      return {
        shareLink: null,
        disabledReason: 'Configure the Sift API REST URL to enable share links',
      };
    }

    try {
      return {
        shareLink: generateLinkFromQuery(hostname, items, timeRange),
        disabledReason: undefined,
      };
    } catch (error) {
      console.error('Failed to generate share link:', error);
      return {
        shareLink: null,
        disabledReason: 'Failed to generate share link',
      };
    }
  }, [apiBaseUrl, frontendUrl, items, queryType, timeRange]);

  const handleOpen = () => {
    if (!shareLink) {
      return;
    }

    openLink(shareLink);
  };

  const handleCopy = async () => {
    if (!shareLink) {
      return;
    }

    try {
      await copyToClipboard(shareLink);

      publishAlert(AppEvents.alertSuccess.name, 'Copied Sift share link to clipboard');
    } catch (err) {
      console.error('Failed to copy link', err);
    }
  };

  return (
    <InlineLabel width="auto" transparent className={className} style={{ marginLeft: 'auto' }}>
      <WithContextMenu
        renderMenuItems={() => (
          <Menu.Group label="Open in Sift">
            <Menu.Item
              label="Open Link"
              disabled={!shareLink}
              onClick={() => {
                handleOpen();
              }}
            />
            <Menu.Item
              label={shareLink ? 'Copy to Clipboard' : 'Copy (URL not set)'}
              disabled={!shareLink}
              onClick={() => {
                void handleCopy();
              }}
            />
          </Menu.Group>
        )}
      >
        {({ openMenu }) => (
          <Button
            onClick={(event) => {
              if (shareLink) {
                handleOpen();
                return;
              }
              openMenu(event);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(event);
            }}
            size="sm"
            variant="secondary"
            aria-label="Open in Sift"
            tooltip={shareLink ? "Open this query in Sift. Right-click for more options" : disabledReason ?? 'Share link unavailable'}
            style={{ display: 'flex', alignItems: 'center', userSelect: 'none' }}
            disabled={!shareLink}
          >
            <SquareShareIcon
              style={{ width: 11, height: 11, marginTop: -1, marginRight: 7 }}
              ></SquareShareIcon>
            <span>Explore in Sift</span>
          </Button>
        )}
      </WithContextMenu>
    </InlineLabel>
  );
};
