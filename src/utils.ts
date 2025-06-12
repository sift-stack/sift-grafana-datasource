import {
  AssetQuery,
  ChannelQuery,
  RunQuery,
  Asset,
  Run,
  Channel,
  ChannelDataQuery,
  QueryTypes,
  QueryType,
  CalculatedChannelDataQuery,
  SiftQuery,
  AssetGrafanaVariable,
} from './types';
import { SelectableInputType, SelectableInputTypes } from './components/input/InputTypeSelect';
import { DateTime, Duration } from 'luxon';
import { ScopedVars, SelectableValue } from '@grafana/data';
import {
  DEFAULT_ASSET_QUERY,
  DEFAULT_CALCULATED_CHANNEL_DATA_QUERY,
  DEFAULT_CALCULATED_CHANNEL_QUERY,
  DEFAULT_CHANNEL_DATA_QUERY,
  DEFAULT_CHANNEL_QUERY,
  DEFAULT_QUERY,
  DEFAULT_RUN_QUERY,
} from './constants';
import { getTemplateSrv } from '@grafana/runtime';

export const getValueAndSelectionTypeFromQuery = (
  query: ChannelQuery | RunQuery | AssetQuery | null | undefined
): [string, SelectableInputType] => {
  let result: [string, SelectableInputType] = ['', SelectableInputTypes.TEXT];
  if (!query) {
    return result;
  }
  const idPropName = Object.keys(query).find((key) => key.endsWith('Id')) ?? '';
  const namePropName = Object.keys(query).find((key) => key.endsWith('Name')) ?? '';

  if ('dashboardVariableName' in query && query.dashboardVariableName) {
    result = [query.dashboardVariableName, SelectableInputTypes.DASHBOARD];
  } else if ('asSelect' in query && query.asSelect) {
    result = [(query as any)[idPropName] || '', SelectableInputTypes.SELECT];
  } else if ('nameAsRegex' in query && query.nameAsRegex) {
    result = [(query as any)[namePropName] || '', SelectableInputTypes.REGEX];
  } else if (idPropName && namePropName) {
    // prioritize the one that has a value
    const value = (query as any)[idPropName] ? (query as any)[idPropName] : (query as any)[namePropName];
    const type = (query as any)[idPropName] ? SelectableInputTypes.ID : SelectableInputTypes.TEXT;
    result = [value, type];
  } else if (idPropName) {
    result = [(query as any)[idPropName], SelectableInputTypes.ID];
  } else if (namePropName) {
    result = [(query as any)[namePropName], SelectableInputTypes.TEXT];
  }
  return result;
};

export const insertAfter = (array: any[], afterValue: any, newValue: any) => {
  const index = array.indexOf(afterValue);
  return index >= 0 ? [...array.slice(0, index + 1), newValue, ...array.slice(index + 1)] : [...array, newValue];
};

export const deleteValue = (array: any[], value: any) => {
  return array.filter((v) => v !== value);
};

export const runQueryFromSelection = (selection: string, selectionType: SelectableInputType): RunQuery => {
  switch (selectionType) {
    case SelectableInputTypes.ID:
      return { runId: selection };
    case SelectableInputTypes.SELECT:
      return { runId: selection, asSelect: true };
    case SelectableInputTypes.REGEX:
      return { runName: selection, nameAsRegex: true };
    default:
      return { runName: selection };
  }
};

export const assetQueryFromSelection = (selection: string, selectionType: SelectableInputType): AssetQuery => {
  switch (selectionType) {
    case SelectableInputTypes.ID:
      return { assetId: selection };
    case SelectableInputTypes.SELECT:
      return { assetId: selection, asSelect: true };
    case SelectableInputTypes.REGEX:
      return { assetName: selection, nameAsRegex: true };
    default:
      return { assetName: selection };
  }
};

export const channelQueryFromSelection = (selection: string, selectionType: SelectableInputType): ChannelQuery => {
  switch (selectionType) {
    case SelectableInputTypes.ID:
      return { channelId: selection };
    case SelectableInputTypes.SELECT:
      return { channelId: selection, asSelect: true };
    case SelectableInputTypes.REGEX:
      return { channelName: selection, nameAsRegex: true };
    default:
      return { channelName: selection };
  }
};

export const assetToSelectableValue = (asset: Asset): SelectableValue<string> => {
  return {
    label: asset.name,
    value: asset.assetId,
  };
};
export const runToSelectableValue = (run: Run): SelectableValue<string> => {
  const startTime = DateTime.fromISO(run.startTime, { zone: 'UTC' });
  const stopTime = DateTime.fromISO(run.stopTime, { zone: 'UTC' });
  const duration = stopTime.diff(startTime, ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds']);

  const getDurationString = (duration: Duration) => {
    if (!duration || !duration.isValid) {
      return '-';
    }
    const nonZeroValues = Object.fromEntries(
      Object.entries(duration.shiftToAll().toObject()).filter(([_, value]) => {
        return value > 0;
      })
    );
    let durationString = '';

    const nonZeroDiff = Duration.fromObject(nonZeroValues);
    if (nonZeroDiff && nonZeroDiff.isValid) {
      durationString = nonZeroDiff.toHuman({ listStyle: 'narrow', unitDisplay: 'narrow' });
    }

    return durationString;
  };

  return {
    label: run.name,
    value: run.runId,
    description: startTime.isValid
      ? `Start: ${startTime.toISO({ suppressSeconds: true })}  Duration: ${getDurationString(duration)}`
      : undefined,
  };
};
export const channelToSelectableValue = (channel: Channel): SelectableValue<string> => {
  return {
    label: channel.name,
    value: channel.channelId,
    description: channel.unit,
  };
};

export const fillInDefaultChannelDataQueries = (
  queryType: QueryType,
  queries?: ChannelDataQuery[]
): ChannelDataQuery[] => {
  if (!queries || queries.length === 0) {
    return queryType === QueryTypes.CHANNEL ? [DEFAULT_CHANNEL_DATA_QUERY] : [DEFAULT_CALCULATED_CHANNEL_DATA_QUERY];
  }
  return queries.map((query) => fillInDefaultChannelDataQuery(query));
};

export const fillInDefaultChannelDataQuery = (query: ChannelDataQuery): ChannelDataQuery => {
  if (!query.assetQueries || query.assetQueries.length === 0) {
    query.assetQueries = [DEFAULT_ASSET_QUERY];
  }
  if (!query.runQueries || query.runQueries.length === 0) {
    query.runQueries = [DEFAULT_RUN_QUERY];
  }
  if (!query.channelQueries || query.channelQueries.length === 0) {
    query.channelQueries = [DEFAULT_CHANNEL_QUERY];
  }
  return query;
};

export const fillInDefaultChannelQueries = (queryType: QueryType, query: ChannelDataQuery): ChannelQuery[] => {
  if (queryType === QueryTypes.CHANNEL) {
    return query.channelQueries && query.channelQueries.length > 0 ? query.channelQueries : [DEFAULT_CHANNEL_QUERY];
  } else {
    const channelReferences = query.calculatedChannelQueries?.[0]?.channelReferences || [];
    if (channelReferences && channelReferences.length) {
      const sortedChannelReferences = channelReferences.sort(
        (a, b) =>
          parseInt(a.channelReference.replace(/\$/g, ''), 10) - parseInt(b.channelReference.replace(/\$/g, ''), 10)
      );
      return sortedChannelReferences.map((c) => c as ChannelQuery);
    } else {
      return [DEFAULT_CHANNEL_QUERY];
    }
  }
};

export const filterQueryBeforeRequest = (query: SiftQuery): SiftQuery => {
  const filteredQueries = query.channelDataQueries
    ?.map((cdq) => {
      return {
        assetQueries: cdq.assetQueries?.filter((aq) => aq && (aq.assetId || aq.assetName || aq.dashboardVariableName)),
        runQueries: cdq.runQueries?.filter((rq) => rq && (rq.runId || rq.runName)),
        channelQueries: cdq.channelQueries?.filter((cq) => cq && (cq.channelId || cq.channelName)),
        calculatedChannelQueries: cdq.calculatedChannelQueries?.map((cq) => {
          return {
            ...cq,
            channelReferences: cq.channelReferences?.filter((cr) => cr && (cr.channelId || cr.channelName)),
          };
        }),
      };
    })
    .filter(
      (cdq) =>
        (cdq.assetQueries && cdq.assetQueries.length) ||
        (cdq.runQueries && cdq.runQueries.length) ||
        (cdq.channelQueries && cdq.channelQueries.length) ||
        (cdq.calculatedChannelQueries && cdq.calculatedChannelQueries.length)
    );
  return {
    ...query,
    channelDataQueries: filteredQueries,
  };
};

export const replaceTemplateVariablesInQuery = (query: SiftQuery, scopedVars: ScopedVars): SiftQuery => {
  const templateSrv = getTemplateSrv();

  function getValuesForVariable(name: string, scopedVars: ScopedVars): string[] {
    const values: string[] = [];
    templateSrv.replace(name, scopedVars, (value: string | string[]) => {
      if (Array.isArray(value)) {
        values.push(...value);
      } else {
        values.push(value);
      }
    });
    return values;
  }

  return {
    ...query,
    channelDataQueries: query.channelDataQueries?.map((cdq) => {
      return {
        ...cdq,
        assetQueries: cdq.assetQueries?.reduce((acc: AssetQuery[], aq: AssetQuery) => {
          // If we have a dashboard variable, handle it separately
          if (aq.dashboardVariableName) {
            const dashboardVarValues = getValuesForVariable(aq.dashboardVariableName, scopedVars);
            if (dashboardVarValues) {
              dashboardVarValues.forEach((v) => {
                acc.push({
                  assetId: v,
                  dashboardVariableName: aq.dashboardVariableName,
                });
              });
            }
          } else {
            acc.push({
              ...aq,
              assetId: templateSrv.replace(aq.assetId || '', scopedVars),
              assetName: templateSrv.replace(aq.assetName || '', scopedVars),
            });
          }
          return acc;
        }, []),
        runQueries: cdq.runQueries?.map((rq) => {
          return {
            ...rq,
            runId: templateSrv.replace(rq.runId || '', scopedVars),
            runName: templateSrv.replace(rq.runName || '', scopedVars),
          };
        }),
        channelQueries: cdq.channelQueries?.map((cq) => {
          return {
            ...cq,
            channelId: templateSrv.replace(cq.channelId || '', scopedVars),
            channelName: templateSrv.replace(cq.channelName || '', scopedVars),
          };
        }),
        calculatedChannelQueries: cdq.calculatedChannelQueries?.map((cc) => {
          return {
            ...cc,
            name: templateSrv.replace(cc.name || '', scopedVars),
            expression: templateSrv.replace(cc.expression || '', scopedVars),
            channelReferences: cc.channelReferences?.map((cr) => {
              return {
                ...cr,
                channelId: templateSrv.replace(cr.channelId || '', scopedVars),
                channelName: templateSrv.replace(cr.channelName || '', scopedVars),
              };
            }),
          };
        }),
      };
    }),
  };
};

export const getSelectedAssetIds = (templateVariable: AssetGrafanaVariable): string[] => {
  if (templateVariable?.current?.value === undefined) {
    return [];
  }
  return Array.isArray(templateVariable.current.value)
    ? templateVariable.current.value
    : [templateVariable.current.value];
};

/**
 * Various utilities to generate CEL expressions when making requests to list
 * endpoints in the gRPC API.
 */
export class CELUtil {
  /**
   * Generates a CEL expression that checks for `field` membership in `val`.
   */
  public static In(field: string, vals: string[]): string {
    if (vals.length === 0) {
      return '';
    }
    const list = vals.map((val) => `"${val}"`).join(',');
    return `${field} in [${list}]`;
  }

  /**
   * Generates a CEL expression that checks for equality
   */
  public static Equals(key: string, value: string | boolean | number | null): string {
    return `${key} == ${typeof value === 'string' ? `"${value}"` : value}`;
  }

  /**
   * Generates a CEL expression that checks for equality of all key-value pairs.
   */
  public static EqualsAll(values: Record<string, string | boolean | number>): string {
    return Object.entries(values)
      .map(([key, value]) => `${key} == ${typeof value === 'string' ? `"${value}"` : value}`)
      .join(' && ');
  }

  /**
   * Generates a CEL expression that checks for equality
   */
  public static EqualsDouble(key: string, value: number | null): string {
    return `${key} == double(${value})`;
  }

  /**
   * Generates a CEL expression that joins all clauses with an AND operator
   */
  public static And(...clauses: string[]): string {
    if (!clauses || clauses.length <= 1) {
      return clauses[0] ?? '';
    }
    return `(${clauses.join(' && ')})`;
  }

  /**
   * Generates a CEL expression that joins all clauses with an OR operator
   */
  public static Or(...clauses: string[]): string {
    if (!clauses || clauses.length <= 1) {
      return clauses[0] ?? '';
    }
    return `(${clauses.join(' || ')})`;
  }

  /**
   * Generates a CEL expression that negates the given clause
   */
  public static Not(clause: string): string {
    return `!(${clause})`;
  }

  /**
   * Generates a CEL expression that checks whether a field is greater than a given value
   */
  public static GreaterThan(field: string, value: number): string {
    return `${field} > ${value}`;
  }

  /**
   /**
   * Generates a CEL expression that checks whether a Timestamp field is greater than or equal to a given ISO timestamp
   */
  public static GreaterThanOrEqualToISOTimestamp(field: string, timestamp: string): string {
    return `${field} >= timestamp("${timestamp}")`;
  }

  /**
   * Generates a CEL expression that checks whether a Timestamp field is less than or equal to a given ISO timestamp
   */
  public static LessThanOrEqualToISOTimestamp(field: string, timestamp: string): string {
    return `${field} <= timestamp("${timestamp}")`;
  }

  /**
   * Generates a CEL expression that checks whether a string field contains a given value
   */
  public static Contains(field: string, value: string): string {
    return `${field}.contains("${value}")`;
  }

  /**
   * Generates a CEL expression that checks for a case-insensitive match on the specified field
   */
  public static CaseInsensitiveMatch(field: string, text: string): string {
    return `${field}.matches("(?i)${regexEscape(text, true)}")`;
  }

  /**
   * An adapter method use primarily for multi-select. Multi-select in the web-app once spoke to
   * endpoint with hardcoded parameters to allow for multi-mode search, but the new list endpoints
   * in gRPC use CEL strings for filtering. This allows the multi-select API to remain the same on the surface.
   *
   * NOTE: Regex throughout out app is case insensitive by default.
   *
   * Valid regex: https://github.com/google/re2/wiki/Syntax
   */
  public static multiModeSearchToFilterString(
    nameMatches: string,
    opts?: {
      caseSensitive?: boolean;
      regexp?: boolean;
    }
  ): string {
    if (opts?.regexp) {
      if (!opts?.caseSensitive) {
        // Regular expressions throughout web-app is case insensitive by default.
        return `name.matches("(?i)${nameMatches}")`;
      }

      // Did they include flags? This extracts the flags.
      // e.g. "(?iU)\d+" => "iU"
      const flags = nameMatches.match(/^\(\?(?<flags>\w+)\)/)?.groups?.flags;

      if (!flags || flags?.includes('i')) {
        // They are already using a flag-less regex or the user included the case insensitive flag,
        // in which case, the user will override the case sensitive option.
        return `name.matches("${nameMatches}")`;
      }

      // They have flags but are missing the case insensitive flag.. for whatever reason
      const flagWithCaseInsensitive = `${flags}i`;
      const regexpCaseInsensitive = nameMatches.replace(/^\(\?\w+\)/, `(?${flagWithCaseInsensitive})`);

      return `name.matches("${regexpCaseInsensitive}")`;
    }

    if (opts?.caseSensitive) {
      return `name.contains("${nameMatches}")`;
    }

    // Treat as a case insensitive regex.
    return `name.matches("(?i)${nameMatches}")`;
  }

  /**
   * Generates a CEL expression that checks for equality of the name field
   */
  public static nameMatches(name: string): string {
    return `name.matches("(?i)${regexEscape(name, true)}")`;
  }
}

export const regexEscape = (regex: string, forCel = false, excludeGrafanaVarChars = false): string => {
  return regex.replace(excludeGrafanaVarChars ? /[.*+?^()|[\]\\]/g : /[.*+?^${}()|[\]\\]/g, forCel ? '\\\\$&' : '\\$&');
};
