import React, { useMemo } from 'react';
import { Button, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { getFrontendHostnameDefaults } from './getFrontendHostnameDefaults';
import { generateLinkFromQuery } from './generateLinkFromQuery';
import type { SharelinkItems, SharelinkTimeRange } from '../../types';
import { SquareShareIcon } from '../common/CustomIcons';

interface SharelinkMenuItemProps {
  items?: SharelinkItems;
  className?: string;
  apiBaseUrl?: string;
  frontendUrl?: string;
  timeRange?: SharelinkTimeRange;
}

function openLink(link: string) {
  console.log('opening sift link: ', link);
  window.open(link, '_blank');
}

async function copyToClipboard(value: string) {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API not available');
    }

    await navigator.clipboard.writeText(value);
    const appEvents = getAppEvents();
    if (appEvents) {
      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: ['Copied Sift share link to clipboard'],
      });
    }
  } catch (err) {
    console.error('Failed to copy link', err);
  }
}

export const OpenInSiftButton = ({ className, items, apiBaseUrl, frontendUrl, timeRange }: SharelinkMenuItemProps) => {
  const { shareLink, disabledReason } = useMemo(() => {
    const trimmedFrontendUrl = frontendUrl?.trim();

    if (!apiBaseUrl && !trimmedFrontendUrl) {
      return {
        shareLink: null,
        disabledReason: 'Configure the Sift API REST URL to enable share links',
      };
    }

    if (!items || !items.channelIds || items.channelIds.length === 0) {
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
    return {
      shareLink: generateLinkFromQuery(hostname, items, timeRange),
      disabledReason: undefined,
    };
  }, [apiBaseUrl, frontendUrl, items, timeRange]);

  return (
    <InlineLabel width="auto" transparent className={className} style={{ marginLeft: 'auto' }}>
      <WithContextMenu
        renderMenuItems={() => (
          <Menu.Group label="Open in Sift">
            <Menu.Item
              label="Open Link"
              disabled={!shareLink}
              onClick={() => {
                if (shareLink) {
                  openLink(shareLink);
                }
              }}
            />
            <Menu.Item
              label={shareLink ? 'Copy to Clipboard' : 'Copy (URL not set)'}
              disabled={!shareLink}
              onClick={() => {
                if (shareLink) {
                  void copyToClipboard(shareLink);
                }
              }}
            />
          </Menu.Group>
        )}
      >
        {({ openMenu }) => (
          <Button
            onClick={(event) => {
              if (shareLink) {
                openLink(shareLink);
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
