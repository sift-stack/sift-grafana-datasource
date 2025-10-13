import React from 'react';
import { Button, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';
import siftLogo from '../../img/logo.svg';

export interface ShareLinkItem {
  assetId?: string;
  runId?: string;
  channelIds: string[];
}

interface SharelinkMenuItemProps {
  items: ShareLinkItem[];
  className?: string;
}

function openLink(link: string) {
  window.open(link, '_blank');
}

export const SharelinkMenuItem = ({ className, items: _items }: SharelinkMenuItemProps) => {
  const testLink = 'https://google.com';

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
            <Menu.Item label="Open Link" onClick={() => openLink(testLink)} />
            <Menu.Item label="Copy to Clipboard" onClick={() => void copyToClipboard(testLink)} />
          </Menu.Group>
        )}
      >
        {({ openMenu }) => (
          <Button
            onClick={() => openLink(testLink)}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(event);
            }}
            size="md"
            fill="text"
            variant="secondary"
            aria-label="Open in Sift"
            tooltip="Open this query in Sift's explorer view"
          >
            <img src={siftLogo} alt="Sift" style={{ width: 20, height: 20 }} />
          </Button>
        )}
      </WithContextMenu>
    </InlineLabel>
  );
};
