import { DataSourcePlugin } from '@grafana/data';
import { SiftDataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { VisualSiftQueryEditor } from './components/VisualSiftQueryEditor';
import { SiftQuery, SiftDataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<SiftDataSource, SiftQuery, SiftDataSourceOptions>(SiftDataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(VisualSiftQueryEditor);
