import { DataSourceJsonData, QueryVariableModel, VariableWithOptions } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export const QUERY_VERSION = '2.1';

export interface Asset {
  assetId: string;
  name: string;
}

export interface Run {
  runId: string;
  name: string;
  startTime: string;
  stopTime: string;
}

export interface Channel {
  channelId: string;
  name: string;
  assetId: string;
  assetName: string;
  unit?: string;
  dataType?: string;
}

export interface ChannelQuery {
  channelId?: string;
  channelName?: string;
  nameAsRegex?: boolean;
  asSelect?: boolean;
}
export interface AssetQuery {
  assetId?: string;
  assetName?: string;
  nameAsRegex?: boolean;
  asSelect?: boolean;
  dashboardVariableName?: string;
}

export interface RunQuery {
  runId?: string;
  runName?: string;
  nameAsRegex?: boolean;
  asSelect?: boolean;
}

export interface ChannelReferenceQuery extends ChannelQuery {
  channelReference: string;
}

export interface CalculatedChannelDataQuery {
  name: string;
  channelReferences: ChannelReferenceQuery[];
  expression: string;
}

export interface ChannelDataQuery {
  assetQueries?: AssetQuery[];
  runQueries?: RunQuery[];
  channelQueries?: ChannelQuery[];
  calculatedChannelQueries?: CalculatedChannelDataQuery[];
}

export type EnumDisplayType = 'string' | 'value' | 'both';

export interface SiftQuery extends DataQuery {
  channelDataQueries?: ChannelDataQuery[];
  combineRuns?: boolean;
  enumDisplay?: EnumDisplayType;
  queryVersion: string;
}

export const DEFAULT_QUERY: Partial<SiftQuery> = {
  channelDataQueries: [],
  combineRuns: true,
  enumDisplay: 'both',
  queryVersion: QUERY_VERSION,
};

/**
 * These are options configured for each DataSource instance
 */
export interface SiftDataSourceOptions extends DataSourceJsonData {
  url?: string;
  frontendUrl?: string;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface SiftSecureJsonData {
  apiKey?: string;
}

/**
 * SiftVariableQuery is used to for queries to the backend for loading data for variable selection
 */
export interface SiftVariableQuery extends DataQuery {}

export type AssetGrafanaVariable = VariableWithOptions & QueryVariableModel;

export type ChannelDataQueryId = string;
export type CalculatedChannelQueryId = string;
export type ChannelQueryId = string;

export const QueryTypes = {
  CHANNEL: 'channel',
  CALCULATED_CHANNEL: 'calculatedChannel',
};

export type QueryType = (typeof QueryTypes)[keyof typeof QueryTypes];

export interface SharelinkCalculatedChannel {
  name: string;
  sourceChannels: string[];
  expression: string;
  expressionDataType: string;
}

export interface SharelinkMetadataResponse {
  channelIds?: string[];
  assetIds?: string[];
  runIds?: string[];
  calculatedChannels?: SharelinkCalculatedChannel[];
}

export interface SharelinkItems extends SharelinkMetadataResponse {
  channelIds: string[];
  calculatedChannels: SharelinkCalculatedChannel[];
}

export interface SharelinkTimeRange {
  from: string; //iso 8601 timestamps
  to: string;
}
