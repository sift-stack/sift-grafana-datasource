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

export const SharelinkMenuItem = ({ className, items: _items }: SharelinkMenuItemProps) => {
  return (
    <InlineLabel width="auto" transparent className={className} style={{ marginLeft: 'auto' }}>
      <WithContextMenu
        renderMenuItems={() => (
          <Menu.Group label="Open in Sift">
            <Menu.Item label="Open Link" />
            <Menu.Item label="Copy to Clipboard" />
          </Menu.Group>
        )}
      >
        {({ openMenu }) => (
          <Button
            onClick={openMenu}
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
