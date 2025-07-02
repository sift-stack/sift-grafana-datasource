import {
  AssetQuery,
  CalculatedChannelDataQuery,
  ChannelDataQuery,
  ChannelQuery,
  RunQuery
} from './types';

export const DEFAULT_ASSET_QUERY: AssetQuery = { asSelect: true };
export const DEFAULT_RUN_QUERY: RunQuery = { asSelect: true };
export const DEFAULT_CHANNEL_QUERY: ChannelQuery = { asSelect: true };
export const DEFAULT_CALCULATED_CHANNEL_QUERY: CalculatedChannelDataQuery = {
  name: '',
  channelReferences: [],
  expression: '',
};
export const DEFAULT_CHANNEL_DATA_QUERY: ChannelDataQuery = {
  assetQueries: [DEFAULT_ASSET_QUERY],
  runQueries: [DEFAULT_RUN_QUERY],
  channelQueries: [DEFAULT_CHANNEL_QUERY],
};
export const DEFAULT_CALCULATED_CHANNEL_DATA_QUERY: ChannelDataQuery = {
  assetQueries: [DEFAULT_ASSET_QUERY],
  runQueries: [DEFAULT_RUN_QUERY],
  calculatedChannelQueries: [DEFAULT_CALCULATED_CHANNEL_QUERY],
};
export const DEFAULT_QUERY: ChannelDataQuery[] = [DEFAULT_CHANNEL_DATA_QUERY];
export const DEFAULT_CALC_QUERY: ChannelDataQuery[] = [DEFAULT_CALCULATED_CHANNEL_DATA_QUERY];
