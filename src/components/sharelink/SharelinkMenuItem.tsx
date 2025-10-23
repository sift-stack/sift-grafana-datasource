import React, { useMemo } from 'react';
import { Button, InlineLabel, Menu, WithContextMenu } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import squareShare from '../../img/squareShare.svg';
import { getFrontendHostname } from './getFrontendHostname';
import { createExplorerLink, type LegendConfigPayload } from './createExplorerLink';

export interface SharelinkItems {
  channelIds: string[];
  assetIds?: string[];
  runIds?: string[];
}

interface SharelinkMenuItemProps {
  items?: SharelinkItems;
  className?: string;
  apiBaseUrl?: string;
}

function openLink(link: string) {
  console.log('opening sift link: ', link)
  window.open(link, '_blank');
}
export const SharelinkMenuItem = ({ className, items, apiBaseUrl }: SharelinkMenuItemProps) => {
  const appEvents = useMemo(() => getAppEvents(), []);

  const { shareLink, disabledReason } = useMemo(() => {
    if (!apiBaseUrl) {
      return {
        shareLink: null,
        disabledReason: "Configure the Sift API REST URL to enable share links",
      };
    }

    if (!items || !items.channelIds || items.channelIds.length === 0) {
      return {
        shareLink: null,
        disabledReason: 'Select a channel to enable share links',
      };
    }

    const hostname = getFrontendHostname(apiBaseUrl);
    if (!hostname) {
      return {
        shareLink: null,
        disabledReason: 'Configure the Sift API REST URL to enable share links',
      };
    }

    const origin = hostname.startsWith('http://') || hostname.startsWith('https://') ? hostname : `https://${hostname}`;
    const channelIds = items.channelIds;
    const channelKeys = channelIds.map((_, index) => `channel-key-${index + 1}`);
    const legendChannels: LegendConfigPayload['channels'] = {};
    channelIds.forEach((channelId, index) => {
      const channelKey = channelKeys[index];
      legendChannels[channelKey] = {
        channelId,
        visible: true,
        // color: '#3d58ff',
        showTooltip: true,
      };
    });

    const altLegend = {
      "left": ["y-axis-1"],
      "right": [],
      "bottom": ["x-axis-1"],
      "axes": {
        "y-axis-1": ["calc-key-1"],
        "x-axis-1": ["calc-key-1"]
      },
      "xAxes": {
        "x-axis-1": {
          "fromDatetime": "",
          "toDatetime": "",
          "minDatetime": "",
          "maxDatetime": ""
        }
      },
      "channels": {
        "calc-key-1": {
          "visible": true,
          "color": "#3d58ff",
          "showTooltip": true,
          "calculatedChannelConfig": {
            "channelKey": "calc-key-1",
            "name": "Average of $1 and $2",
            "channelReferences": {
              "$1": "raw-channel-id-1",
              "$2": "raw-channel-id-2"
            },
            "expression": "($1 + $2) / 2",
            "dataType": "double",
            "unitAbbreviatedName": ""
          }
        }
      },
      "stringChannelKeys": [],
      "axesRunLookup": {},
      "axesDataZoom": {
        "y-axis-1": [0, 100]
      },
      "axesCustomScale": {},
      "axesScaleType": {
        "y-axis-1": "linear"
      }
    }

    const altLegend2 = {
      "left": ["y-axis-1"],
      "right": [],
      "bottom": ["x-axis-1"],
      "axes": {
        "y-axis-1": ["channel-key-1"],
        "x-axis-1": ["channel-key-1"]
      },
      "xAxes": {
        "x-axis-1": {
          "fromDatetime": "",
          "toDatetime": "",
          "minDatetime": "",
          "maxDatetime": ""
        }
      },
      "channels": {
        "channel-key-1": {
          "channelId": "your-channel-id",
          "visible": true,
          "color": "#3d58ff",
          "showTooltip": true
        }
      },
      "stringChannelKeys": [],
      "axesRunLookup": {},
      "axesDataZoom": {
        "y-axis-1": [0, 100]
      },
      "axesCustomScale": {},
      "axesScaleType": {
        "y-axis-1": "linear"
      }
    }

    const legend: LegendConfigPayload = {
      left: ['y-axis-1'],
      right: [],
      bottom: ['x-axis-1'],
      axes: {
        'y-axis-1': channelKeys,
        'x-axis-1': channelKeys,
      },
      xAxes: {
        "x-axis-1": {
          "fromDatetime": "",
          "toDatetime": "",
          "minDatetime": "",
          "maxDatetime": ""
        }
      },
      channels: legendChannels,
      stringChannelKeys: [],
      axesRunLookup: {},
      axesDataZoom: {
        "y-axis-1": [0,100]
      },
      axesScaleType: {
        "y-axis-1": "linear"
      }
    };

    const assets = items.assetIds && items.assetIds.length > 0 ? items.assetIds : undefined;
    const runs = items.runIds && items.runIds.length > 0 ? items.runIds : undefined;

    return {
      shareLink: createExplorerLink({
        origin,
        assets,
        runs,
        legend,
      }),
      disabledReason: undefined,
    };
  }, [apiBaseUrl, items]);

  const copyToClipboard = async (value: string) => {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard API not available');
      }

      await navigator.clipboard.writeText(value);
      if (appEvents) {
        appEvents.publish({
          type: AppEvents.alertSuccess.name,
          payload: ['Copied Sift share link to clipboard'],
        });
      }
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
            size="sm"

            variant="secondary"
            aria-label="Open in Sift"
            tooltip={
              shareLink
                ? "Open this query in Sift's explorer view"
                : disabledReason ?? 'Share link unavailable'
            }
            style={{display: "flex", alignItems: 'center', userSelect: "none"}}
          >
            <img src={squareShare} alt="Share Button" style={{ width: 11, height: 11, marginTop: -1, marginRight: 7 }} />
            <span>Explore in Sift</span>
          </Button>
        )}
      </WithContextMenu>
    </InlineLabel>
  );
};
