import React, { useMemo } from 'react';
import { Button, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';
import siftLogo from '../../img/logo.svg';
import { getFrontendHostname } from './getFrontendHostname';

export interface ShareLinkItem {
  assetId?: string;
  runId?: string;
  channelIds: string[];
}

interface SharelinkMenuItemProps {
  items: ShareLinkItem[];
  className?: string;
  apiBaseUrl?: string;
}

function openLink(link: string) {
  window.open(link, '_blank');
}
export const SharelinkMenuItem = ({ className, items: _items, apiBaseUrl }: SharelinkMenuItemProps) => {
  const shareLink = useMemo(() => {
    if (!apiBaseUrl) {
      return null;
    }

    const hostname = getFrontendHostname(apiBaseUrl);
    if (!hostname) {
      return null;
    }

    return hostname.startsWith('http://') || hostname.startsWith('https://') ? hostname : `https://${hostname}`;
  }, [apiBaseUrl]);

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
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
                if (shareLink) {
                  openLink(shareLink);
                }
              }}
            />
            {/*todo: provide instructions for setting a frontend url manually*/}
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
            size="md"
            fill="text"
            variant="secondary"
            aria-label="Open in Sift"
            tooltip={
              shareLink
                ? "Open this query in Sift's explorer view"
                : "Configure the Sift API REST URL to enable share links"
            }
          >
            <img src={siftLogo} alt="Sift" style={{ width: 20, height: 20 }} />
          </Button>
        )}
      </WithContextMenu>
    </InlineLabel>
  );
};
