import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface Channel {
  channelId?: string;
  channelIdentifier?: string;
}
export interface Asset {
  assetId?: string;
  assetName?: string;
}

export interface Run {
  runId?: string;
  name?: string;
}

export interface ChannelReference extends Channel {
  channelReference: string;
}

export interface AssetChannelQuery extends Asset, Channel {
  runId?: string;
  runName?: string;
}

export interface CalculatedChannelQuery {
  name: string;
  asset: Asset;
  channelReferences: ChannelReference[];
  expression: string;
}

export interface SiftQuery extends DataQuery {
  queries: AssetChannelQuery[];
  calculatedChannelQuery?: CalculatedChannelQuery;
  groupByRun?: boolean;
  runId?: string;
  runName?: string;
}

export const DEFAULT_QUERY: Partial<SiftQuery> = {
  queries: [],
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
