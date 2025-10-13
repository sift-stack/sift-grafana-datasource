import React from 'react';
import { IconButton, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';

interface SharelinkMenuItemProps {
  className?: string;
}

export const SharelinkMenuItem = ({ className }: SharelinkMenuItemProps) => {
  return (
    <InlineLabel width="auto" transparent className={className} style={{ marginLeft: 'auto' }}>
      <WithContextMenu
        renderMenuItems={() => (
          <Menu.Group label="Test">
            <Menu.Item label="First" />
            <Menu.Item label="Second" />
          </Menu.Group>
        )}
      >
        {({ openMenu }) => <IconButton name="info-circle" onClick={openMenu} />}
      </WithContextMenu>
    </InlineLabel>
  );
};
