import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { SiftDataSource } from './datasource';
import { Asset, Run, Channel, AssetGrafanaVariable } from './types';
import { getTemplateSrv, getAppEvents, RefreshEvent } from '@grafana/runtime';
import { TypedVariableModel, BusEventWithPayload } from '@grafana/data';
import { CELUtil } from './utils';
import { debounce } from 'lodash';
import leven from 'leven';

export const useFetchAssets = (
  datasource: SiftDataSource,
  debounceTime = 250
): {
  assets: Asset[];
  loading: boolean;
  loadAssets: (searchTerm?: string, assetIds?: string[]) => Promise<void>;
} => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  // Use a ref to hold the latest searchTerm for debounced calls
  const latestSearchTermRef = useRef<string | undefined>();

  // Wrap fetchAssets in useCallback so it is stable for useMemo deps
  const fetchAssets = useCallback(
    async (searchTerm?: string, assetIds?: string[]) => {
      try {
        let assets: Asset[] = [];
        // first fetch assets that are explicitly requested
        if (assetIds && assetIds.length > 0) {
          const response = await datasource.getResource<{
            assets: Asset[];
          }>('assets', { filter: CELUtil.In('asset_id', assetIds) });
          assets.push(...(response.assets || []));
        }

        const response = await datasource.getResource<{
          assets: Asset[];
        }>('assets', { filter: searchTerm ? CELUtil.CaseInsensitiveMatch('name', searchTerm) : '' });

        let sortedResponseAssets = response.assets;
        if (searchTerm) {
          sortedResponseAssets = response.assets.sort((a, b) => {
            const levenA = leven(a.name, searchTerm);
            const levenB = leven(b.name, searchTerm);
            if (levenA === levenB) {
              return a.assetId.localeCompare(b.assetId);
            }
            return levenA - levenB;
          });
        }

        assets.push(...(sortedResponseAssets || []));
        // deduplicate by assetId
        const uniqueAssets = Object.values(
          assets.reduce((acc, asset) => {
            acc[asset.assetId] = asset;
            return acc;
          }, {} as Record<string, Asset>)
        );
        setAssets(uniqueAssets);
      } catch (error) {
        console.error('Error loading assets:', error);
      } finally {
        setLoading(false);
      }
    },
    [datasource]
  );

  // Debounced version of fetchAssets
  const debouncedFetchAssets = useMemo(
    () =>
      debounce((searchTerm?: string, assetIds?: string[]) => {
        void fetchAssets(searchTerm, assetIds);
      }, debounceTime),
    [debounceTime, fetchAssets]
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      debouncedFetchAssets.cancel();
    };
  }, [debouncedFetchAssets]);

  // The function to call from outside: sets loading immediately, then debounces fetch
  const loadAssets = useCallback(
    async (searchTerm?: string, assetIds?: string[]): Promise<void> => {
      setLoading(true);
      latestSearchTermRef.current = searchTerm;
      debouncedFetchAssets(searchTerm, assetIds);
    },
    [debouncedFetchAssets, setLoading]
  );

  return { assets, loading, loadAssets };
};

export const useFetchRuns = (
  datasource: SiftDataSource,
  debounceTime = 250
): {
  runs: Run[];
  loading: boolean;
  loadRuns: (assetIds: string[], searchTerm?: string, runIds?: string[]) => Promise<void>;
} => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const latestArgsRef = useRef<{ assetIds: string[]; searchTerm?: string; runIds?: string[] }>();

  const fetchRuns = useCallback(
    async (assetIds: string[], searchTerm?: string, runIds?: string[]) => {
      if (assetIds.length === 0) {
        setRuns([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        let runs: Run[] = [];
        if (runIds && runIds.length > 0) {
          const response = await datasource.getResource<{ runs: Run[] }>('runs', {
            filter: CELUtil.In('run_id', runIds),
          });
          runs.push(...(response.runs || []));
        }
        const response = await datasource.getResource<{ runs: Run[] }>('runs', {
          filter: searchTerm
            ? CELUtil.And(CELUtil.In('asset_id', assetIds), CELUtil.CaseInsensitiveMatch('name', searchTerm))
            : CELUtil.In('asset_id', assetIds),
        });

        let sortedResponseRuns = response.runs;
        if (searchTerm) {
          // Sort by similarity to search term
          sortedResponseRuns = sortedResponseRuns.sort((a, b) => {
            const levenA = leven(a.name, searchTerm);
            const levenB = leven(b.name, searchTerm);
            if (levenA === levenB) {
              const aTime = new Date(a.startTime);
              const bTime = new Date(a.startTime);
              return bTime.getTime() - aTime.getTime();
            }
            return levenA - levenB;
          });
        } else {
          // Default sort by start time
          sortedResponseRuns = sortedResponseRuns.sort((a, b) => {
            const aTime = new Date(a.startTime);
            const bTime = new Date(b.startTime);
            return bTime.getTime() - aTime.getTime();
          });
        }

        runs.push(...(sortedResponseRuns || []));
        // deduplicate by runId
        const uniqueRuns = Object.values(
          runs.reduce((acc, run) => {
            acc[run.runId] = run;
            return acc;
          }, {} as Record<string, Run>)
        );
        setRuns(uniqueRuns);
      } catch (error) {
        console.error('Error loading runs:', error);
      } finally {
        setLoading(false);
      }
    },
    [datasource]
  );

  const debouncedFetchRuns = useMemo(() => debounce(fetchRuns, debounceTime), [debounceTime, fetchRuns]);

  useEffect(() => {
    return () => {
      debouncedFetchRuns.cancel && debouncedFetchRuns.cancel();
    };
  }, [debouncedFetchRuns]);

  const loadRuns = useCallback(
    async (assetIds: string[], searchTerm?: string, runIds?: string[]): Promise<void> => {
      setLoading(true);
      latestArgsRef.current = { assetIds, searchTerm, runIds };
      debouncedFetchRuns(assetIds, searchTerm, runIds);
    },
    [debouncedFetchRuns, setLoading]
  );

  return { runs, loading, loadRuns };
};

export const useFetchChannels = (
  datasource: SiftDataSource,
  debounceTime = 250
): {
  channels: Channel[];
  loading: boolean;
  loadChannels: (assetIds: string[], searchTerm?: string, channelIds?: string[]) => Promise<void>;
} => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const latestArgsRef = useRef<{ assetIds: string[]; searchTerm?: string; channelIds?: string[] }>();

  const fetchChannels = useCallback(
    async (assetIds: string[], searchTerm?: string, channelIds?: string[]) => {
      if (assetIds.length === 0) {
        setChannels([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        let channels: Channel[] = [];
        if (channelIds && channelIds.length > 0) {
          const response = await datasource.getResource<{ channels: Channel[] }>('channels', { channelIds });
          channels.push(...(response.channels || []));
        }
        const response = await datasource.getResource<{ channels: Channel[] }>('channels', {
          searchTerm: searchTerm || '',
          assetIds,
        });

        let sortedResponseChannels = response.channels;
        if (searchTerm) {
          sortedResponseChannels = sortedResponseChannels.sort((a, b) => {
            const levenA = leven(a.name, searchTerm);
            const levenB = leven(b.name, searchTerm);
            if (levenA === levenB) {
              return a.channelId.localeCompare(b.channelId);
            }
            return levenA - levenB;
          });
        }

        channels.push(...(sortedResponseChannels || []));

        // deduplicate by channelId
        const uniqueChannels = Object.values(
          channels.reduce((acc, ch) => {
            acc[ch.channelId] = ch;
            return acc;
          }, {} as Record<string, Channel>)
        );
        // deduplicate by name, will have to "undo" on backend
        const uniqueChannelsByName = Object.values(
          uniqueChannels.reduce((acc, ch) => {
            if (!acc[ch.name]) {
              acc[ch.name] = ch;
            }
            return acc;
          }, {} as Record<string, Channel>)
        );
        setChannels(uniqueChannelsByName);
      } catch (error) {
        console.error('Error loading channels:', error);
      } finally {
        setLoading(false);
      }
    },
    [datasource]
  );

  const debouncedFetchChannels = useMemo(() => debounce(fetchChannels, debounceTime), [debounceTime, fetchChannels]);

  useEffect(() => {
    return () => {
      debouncedFetchChannels.cancel && debouncedFetchChannels.cancel();
    };
  }, [debouncedFetchChannels]);

  const loadChannels = useCallback(
    async (assetIds: string[], searchTerm?: string, channelIds?: string[]): Promise<void> => {
      setLoading(true);
      latestArgsRef.current = { assetIds, searchTerm, channelIds };
      debouncedFetchChannels(assetIds, searchTerm, channelIds);
    },
    [debouncedFetchChannels, setLoading]
  );

  return { channels, loading, loadChannels };
};

class VariablesChangedEvent extends BusEventWithPayload<unknown> {
  static readonly type = 'variables-changed';
}

export function useSiftAssetVariables(): AssetGrafanaVariable[] {
  const filterSiftVariables = (variables: TypedVariableModel[]): AssetGrafanaVariable[] => {
    return variables.filter((variable) => {
      // Check if this is a query variable using our datasource
      if (variable.type !== 'query') {
        return false;
      }
      return variable.datasource?.type === 'sift-grafana-datasource';
    }) as AssetGrafanaVariable[];
  };

  const [vars, setVars] = useState<AssetGrafanaVariable[]>(() => {
    const allVars = getTemplateSrv().getVariables();
    return filterSiftVariables(allVars);
  });

  useEffect(() => {
    const eventBus = getAppEvents();

    // when dashboard is refreshed (time change, manual refresh, etc)
    const refreshSub = eventBus.getStream(RefreshEvent).subscribe(() => {
      const allVars = getTemplateSrv().getVariables();
      setVars(filterSiftVariables(allVars));
    });
    // when dashboard variable changes
    const varSub = eventBus.getStream(VariablesChangedEvent).subscribe(() => {
      const allVars = getTemplateSrv().getVariables();
      setVars(filterSiftVariables(allVars));
    });

    return () => {
      refreshSub.unsubscribe();
      varSub.unsubscribe();
    };
  }, []);
  return vars;
}
