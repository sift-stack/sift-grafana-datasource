import { from, Observable } from 'rxjs';
import { CustomVariableSupport, DataQueryRequest, DataQueryResponse } from '@grafana/data';
import { SiftDataSource } from 'datasource';
import { Asset, SiftVariableQuery } from 'types';
import { SiftVariableQueryEditor } from 'components/VariableQueryEditor';

export class SiftVariableSupport extends CustomVariableSupport<SiftDataSource, SiftVariableQuery> {
  constructor(private readonly datasource: SiftDataSource) {
    super();

    this.query = this.query.bind(this);
  }
  editor = SiftVariableQueryEditor;

  query(_request: DataQueryRequest<SiftVariableQuery>): Observable<DataQueryResponse> {
    return from(
      this.datasource
        .getResource<{
          assets: Asset[];
        }>('assets', { limit: 10_000 })
        .then((assets) => {
          return {
            data: assets.assets.map((asset: Asset) => {
              return {
                text: asset.name,
                value: asset.assetId,
              };
            }),
          };
        })
    );
  }
}
