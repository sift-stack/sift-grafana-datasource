import React, { ChangeEvent } from 'react';
import { InlineField, Input, SecretInput, Stack } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { SiftDataSourceOptions, SiftSecureJsonData } from '../legacyTypes';

interface Props extends DataSourcePluginOptionsEditorProps<SiftDataSourceOptions> {}

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;

  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const jsonData = {
      ...options.jsonData,
      url: event.target.value,
    };
    onOptionsChange({ ...options, jsonData });
  };

  const onFrontendUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const jsonData = {
      ...options.jsonData,
      frontendUrl: event.target.value,
    };
    onOptionsChange({ ...options, jsonData });
  };

  const onQueryTimeoutChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    const parsed = raw === '' ? undefined : parseInt(raw, 10);
    const queryTimeoutSeconds =
      parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;
    const jsonData = {
      ...options.jsonData,
      queryTimeoutSeconds,
    };
    onOptionsChange({ ...options, jsonData });
  };

  // Secure field (only sent to the backend)
  const onAPIKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: {
        apiKey: event.target.value,
      },
    });
  };

  const onResetAPIKey = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: {
        ...options.secureJsonFields,
        apiKey: false,
      },
      secureJsonData: {
        ...options.secureJsonData,
        apiKey: '',
      },
    });
  };

  const { jsonData, secureJsonFields } = options;
  const secureJsonData = (options.secureJsonData || {}) as SiftSecureJsonData;

  return (
    <Stack direction="column">
      <InlineField
        label="API REST URL"
        labelWidth={20}
        tooltip="This can be found on the 'Sift > Manage > API Keys' page."
      >
        <Input onChange={onUrlChange} value={jsonData.url || ''} placeholder="Sift REST API URL" width={40} />
      </InlineField>
      <InlineField
        label="API Key"
        labelWidth={20}
        tooltip="This can be generated on the 'Sift > Manage > API Keys' page."
      >
        <SecretInput
          isConfigured={(secureJsonFields && secureJsonFields.apiKey) as boolean}
          value={secureJsonData.apiKey || ''}
          placeholder="Sift API key"
          width={40}
          onReset={onResetAPIKey}
          onChange={onAPIKeyChange}
        />
      </InlineField>
      <InlineField
        label="App Frontend URL"
        labelWidth={20}
        tooltip="Only required for non standard or on premise deployments"
      >
        <Input
          onChange={onFrontendUrlChange}
          value={jsonData.frontendUrl || ''}
          placeholder="Sift frontend URL (optional)"
          width={40}
        />
      </InlineField>
      <InlineField
        label="Query timeout (s)"
        labelWidth={20}
        tooltip="Max seconds to wait for the Sift API per request. Leaving blank will use the default (300 seconds)."
      >
        <Input
          type="number"
          min={1}
          onChange={onQueryTimeoutChange}
          value={
            jsonData.queryTimeoutSeconds != null && jsonData.queryTimeoutSeconds > 0
              ? String(jsonData.queryTimeoutSeconds)
              : ''
          }
          placeholder="300"
          width={20}
        />
      </InlineField>
    </Stack>
  );
}
