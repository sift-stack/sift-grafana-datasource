package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertQuery(t *testing.T) {
	tests := []struct {
		name           string
		input          string
		needsMigration bool
		expected       *queryModel
		expectError    bool
	}{
		{
			name: "legacy query with single channel",
			input: `{
				"queries": [
					{
						"assetId": "asset123",
						"assetName": "Asset One",
						"channelId": "channel456",
						"channelIdentifier": "Channel A",
						"runId": "run789",
						"runName": "Run One"
					}
				],
				"groupByRun": true
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  false,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "asset123",
								AsSelect: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunId:    "run789",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with single channel, regex",
			input: `{
				"queries": [
					{
						"assetId": "",
						"assetName": "Asset One",
						"channelId": "",
						"channelIdentifier": "Channel A",
						"runId": "",
						"runName": "Run One"
					}
				],
				"groupByRun": true
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  false,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetName:   "Asset One",
								NameAsRegex: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunName:     "Run One",
								NameAsRegex: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelName: "Channel A",
								NameAsRegex: true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with calculated channel",
			input: `{
				"calculatedChannelQuery": {
					"asset": {
						"assetId": "asset123",
						"assetName": "Asset One"
					},
					"channelReferences": [
						{
							"channelReference": "a",
							"channelId": "channel456",
							"channelIdentifier": "Channel A"
						},
						{
							"channelReference": "b",
							"channelId": "channel789",
							"channelIdentifier": "Channel B"
						}
					],
					"expression": "a + b",
					"name": "Calculated Channel"
				},
				"runId": "run789",
				"runName": "Run One"
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "asset123",
								AsSelect: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunId:    "run789",
								AsSelect: true,
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name: "Calculated Channel",
								ChannelReferences: []channelReferenceQuery{
									{
										ChannelReference: "a",
										channelQuery: channelQuery{
											ChannelId: "channel456",
											AsSelect:  true,
										},
									},
									{
										ChannelReference: "b",
										channelQuery: channelQuery{
											ChannelId: "channel789",
											AsSelect:  true,
										},
									},
								},
								Expression: "a + b",
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with calculated channel, regex",
			input: `{
				"calculatedChannelQuery": {
					"asset": {
						"assetId": "",
						"assetName": "Asset One"
					},
					"channelReferences": [
						{
							"channelReference": "a",
							"channelId": "",
							"channelIdentifier": "Channel A"
						},
						{
							"channelReference": "b",
							"channelId": "",
							"channelIdentifier": "Channel B"
						}
					],
					"expression": "a + b",
					"name": "Calculated Channel"
				},
				"runId": "",
				"runName": "Run One"
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetName:   "Asset One",
								NameAsRegex: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunName:     "Run One",
								NameAsRegex: true,
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name: "Calculated Channel",
								ChannelReferences: []channelReferenceQuery{
									{
										ChannelReference: "a",
										channelQuery: channelQuery{
											ChannelName: "Channel A",
											NameAsRegex: true,
										},
									},
									{
										ChannelReference: "b",
										channelQuery: channelQuery{
											ChannelName: "Channel B",
											NameAsRegex: true,
										},
									},
								},
								Expression: "a + b",
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with no run",
			input: `{
				"queries": [
					{
						"assetId": "asset123",
						"assetName": "Asset One",
						"channelId": "channel456",
						"channelIdentifier": "Channel A"
					}
				],
				"groupByRun": true
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  false,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "asset123",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with comma-separated asset names",
			input: `{
				"queries": [
					{
						"assetId": "",
						"assetName": "Asset One,Asset Two,Asset Three",
						"channelId": "channel456",
						"channelIdentifier": "Channel A",
						"runId": "run789",
						"runName": "Run One"
					}
				],
				"groupByRun": false
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetName:   "Asset One",
								NameAsRegex: true,
							},
							{
								AssetName:   "Asset Two",
								NameAsRegex: true,
							},
							{
								AssetName:   "Asset Three",
								NameAsRegex: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunId:    "run789",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query with dashboard variable",
			input: `{
				"queries": [
					{
						"assetId": "",
						"assetName": "${assetVar}",
						"channelId": "channel456",
						"channelIdentifier": "Channel A",
						"runId": "run789",
						"runName": "Run One"
					}
				],
				"groupByRun": false
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								DashboardVariableName: "${assetVar}",
							},
						},
						RunQueries: []runQuery{
							{
								RunId:    "run789",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "modern query - no migration needed",
			input: `{
				"channelDataQueries": [
					{
						"assetQueries": [{"assetId": "asset123"}],
						"runQueries": [{"runId": "run789"}],
						"channelQueries": [{"channelId": "channel456"}]
					}
				],
				"combineRuns": false
			}`,
			needsMigration: false,
			expected: &queryModel{
				CombineRuns:  false,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "asset123",
								AsSelect: true,
							},
						},
						RunQueries: []runQuery{
							{
								RunId:    "run789",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "annotation query without queryVersion preserves annotation fields through migration",
			input: `{
				"refId": "Anno",
				"annotationType": "annotationsQuery",
				"annotationFilter": "asset_name=='blah'"
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:      true,
				QueryVersion:     QueryVersion,
				AnnotationType:   "annotationsQuery",
				AnnotationFilter: "asset_name=='blah'",
			},
			expectError: false,
		},
		{
			name: "annotation query without queryVersion and empty filter preserves annotationType",
			input: `{
				"refId": "Anno",
				"annotationType": "annotationsQuery"
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:    true,
				QueryVersion:   QueryVersion,
				AnnotationType: "annotationsQuery",
			},
			expectError: false,
		},
		{
			name:           "invalid json",
			input:          `{invalid json}`,
			needsMigration: false,
			expectError:    true,
		},
		{
			name: "legacy query - customer example 1",
			input: `{
				"queries": [
					{
						"assetId": "1234",
						"assetName": "AssetName",
						"channelId": "channel456",
						"channelIdentifier": "Channel A"
					}
				]
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "1234",
								AsSelect: true,
							},
						},
						ChannelQueries: []channelQuery{
							{
								ChannelId: "channel456",
								AsSelect:  true,
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query - customer example 2",
			input: `{
				"calculatedChannelQuery": {
                "asset": {
                  "assetId": "asset1234",
                  "assetName": "AssetName"
                },
                "channelReferences": [
                  {
                    "channelId": "chan1",
                    "channelReference": "$1"
                  },
                 {
                    "channelId": "chan2",
                    "channelReference": "$2"
                  },
                  {
                    "channelId": "chan3",
                    "channelReference": "$3"
                  },
                  {
                    "channelId": "chan4",
                    "channelReference": "$4"
                  }
                ],
                "expression": "avg(deriv($1+$2+$3+$3) * 1000, rolling(30))",
                "name": "Moving average change"
              }
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetId:  "asset1234",
								AsSelect: true,
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name: "Moving average change",
								ChannelReferences: []channelReferenceQuery{
									{
										ChannelReference: "$1",
										channelQuery: channelQuery{
											ChannelId: "chan1",
											AsSelect:  true,
										},
									},
									{
										ChannelReference: "$2",
										channelQuery: channelQuery{
											ChannelId: "chan2",
											AsSelect:  true,
										},
									},
									{
										ChannelReference: "$3",
										channelQuery: channelQuery{
											ChannelId: "chan3",
											AsSelect:  true,
										},
									},
									{
										ChannelReference: "$4",
										channelQuery: channelQuery{
											ChannelId: "chan4",
											AsSelect:  true,
										},
									},
								},
								Expression: "avg(deriv($1+$2+$3+$3) * 1000, rolling(30))",
							},
						},
					},
				},
			},
			expectError: false,
		},
		{
			name: "legacy query - customer example 3",
			input: `{
				"calculatedChannelQuery": {
                "asset": {
                  "assetName": "AssetName"
                },
                "channelReferences": [
                  {
                    "channelIdentifier": "chan1",
                    "channelReference": "$1"
                  },
                 {
                    "channelIdentifier": "chan2",
                    "channelReference": "$2"
                  }
                ],
                "expression": "$1 + $2",
                "name": "Something"
              }
			}`,
			needsMigration: true,
			expected: &queryModel{
				CombineRuns:  true,
				QueryVersion: QueryVersion,
				ChannelDataQueries: []channelDataQuery{
					{
						AssetQueries: []assetQuery{
							{
								AssetName:   "AssetName",
								NameAsRegex: true,
							},
						},
						CalculatedChannelQueries: []calculatedChannelQuery{
							{
								Name: "Something",
								ChannelReferences: []channelReferenceQuery{
									{
										ChannelReference: "$1",
										channelQuery: channelQuery{
											ChannelName: "chan1",
											NameAsRegex: true,
										},
									},
									{
										ChannelReference: "$2",
										channelQuery: channelQuery{
											ChannelName: "chan2",
											NameAsRegex: true,
										},
									},
								},
								Expression: "$1 + $2",
							},
						},
					},
				},
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query := json.RawMessage(tt.input)

			// Test convertQueryIfNeeded first
			result, err := convertQueryIfNeeded(query)

			if tt.expectError {
				assert.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.NotNil(t, result)

			// If direct conversion is needed, also test convertLegacyQuery
			if tt.needsMigration {
				directResult, err := convertLegacyQuery(query)
				require.NoError(t, err)

				// Use a full object comparison
				assert.Equal(t, tt.expected, directResult)
			}
		})
	}
}

func TestCallResourceMigrateQuery(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		requestBody    string
		expectedStatus int
		expectError    bool
	}{
		{
			name:   "successful migration",
			method: http.MethodPost,
			requestBody: `{
				"refId": "A",
				"json": {
					"queries": [
						{
							"assetId": "asset123",
							"assetName": "Asset One",
							"channelId": "channel456",
							"channelIdentifier": "Channel A",
							"runId": "run789",
							"runName": "Run One"
						}
					],
					"groupByRun": true
				}
			}`,
			expectedStatus: http.StatusOK,
			expectError:    false,
		},
		{
			name:           "wrong method",
			method:         http.MethodGet,
			requestBody:    `{}`,
			expectedStatus: http.StatusNotFound,
			expectError:    false,
		},
		{
			name:           "invalid json",
			method:         http.MethodPost,
			requestBody:    `{invalid json}`,
			expectedStatus: http.StatusBadRequest,
			expectError:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ds := &SiftDatasource{}

			req := &backend.CallResourceRequest{
				Method: tt.method,
				Body:   []byte(tt.requestBody),
			}

			sender := &mockCallResourceResponseSender{}

			err := ds.callResourceMigrateQuery(context.Background(), req, sender)
			if tt.expectError {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)
			assert.Equal(t, tt.expectedStatus, sender.status)
		})
	}
}

// Mock implementation of CallResourceResponseSender for testing
type mockCallResourceResponseSender struct {
	status int
	body   []byte
}

func (m *mockCallResourceResponseSender) Send(resp *backend.CallResourceResponse) error {
	m.status = resp.Status
	m.body = resp.Body
	return nil
}
