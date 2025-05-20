package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"net/http"
	"strings"
)

type legacyCalculatedChannelQuery struct {
	Asset struct {
		AssetId   string `json:"assetId"`
		AssetName string `json:"assetName"`
	} `json:"asset"`
	ChannelReferences []struct {
		ChannelReference  string `json:"channelReference"`
		ChannelId         string `json:"channelId"`
		ChannelIdentifier string `json:"channelIdentifier"`
	} `json:"channelReferences"`
	Expression string `json:"expression"`
	Name       string `json:"name"`
}

type legacySubQuery struct {
	AssetId           string `json:"assetId"`
	AssetName         string `json:"assetName"`
	ChannelId         string `json:"channelId"`
	ChannelIdentifier string `json:"channelIdentifier"`
	RunId             string `json:"runId"`
	RunName           string `json:"runName"`
}

type legacyQueryModel struct {
	Queries                []legacySubQuery              `json:"queries"`
	CalculatedChannelQuery *legacyCalculatedChannelQuery `json:"calculatedChannelQuery"`
	GroupByRun             bool                          `json:"groupByRun"`
	RunId                  string                        `json:"runId"`
	RunName                string                        `json:"runName"`
	Hide                   bool                          `json:"hide"`
}

// convertQueryIfNeeded checks if the query is in a legacy format and converts it if needed
func convertQueryIfNeeded(q json.RawMessage) (*queryModel, error) {
	// First unmarshal into a map to check for legacy fields
	var jsonMap map[string]interface{}
	if err := json.Unmarshal(q, &jsonMap); err != nil {
		return nil, fmt.Errorf("failed to parse query JSON %q: %w", q, err)
	}

	// Check for query version
	queryVersion, hasQueryVersion := jsonMap["queryVersion"]

	// query version "1" is the legacy format, but it did not provide versioning
	if !hasQueryVersion {
		migratedModel, err := convertQuery(q)
		if err != nil {
			return nil, fmt.Errorf("query migration failed: %w", err)
		}
		return migratedModel, nil
	} else {
		switch queryVersion {
		case "2":
			// Not a legacy query, parse normally
			var fqm queryModel
			if err := json.Unmarshal(q, &fqm); err != nil {
				return nil, fmt.Errorf("failed to parse query model: %w", err)
			}

			return &fqm, nil

		default:
			return nil, fmt.Errorf("unknown query version: %v", queryVersion)

		}
	}
}

// convertQuery parses a given DataQuery and migrates it if necessary.
func convertQuery(orig json.RawMessage) (*queryModel, error) {
	log.DefaultLogger.Info("migrating query", "query", orig)

	input := &legacyQueryModel{}
	err := json.Unmarshal(orig, input)
	if err != nil {
		return nil, fmt.Errorf("unable to unmarshal: %w", err)
	}

	migratedInput := &queryModel{
		CombineRuns:  !input.GroupByRun,
		QueryVersion: QueryVersion,
	}

	// Map to store unique asset+run combinations to reduce the number of unique SELECT blocks
	// Key format: "assetId:assetName:runId:runName"
	queryGroups := make(map[string]int)
	// Process regular queries
	if input.CalculatedChannelQuery == nil {
		for _, q := range input.Queries {
			key := fmt.Sprintf("%s:%s:%s:%s", q.AssetId, q.AssetName, q.RunId, q.RunName)
			if idx, exists := queryGroups[key]; exists {
				// Add this channel to the existing query instead of making a new one
				migratedInput.ChannelDataQueries[idx].ChannelQueries = append(
					migratedInput.ChannelDataQueries[idx].ChannelQueries,
					queryToChannelQuery(q),
				)
			} else {
				cdq := channelDataQuery{
					ChannelQueries: []channelQuery{
						queryToChannelQuery(q),
					},
				}

				if q.AssetId != "" {
					cdq.AssetQueries = []assetQuery{
						{
							AssetId:     q.AssetId,
							NameAsRegex: false,
							AsSelect:    true,
						},
					}
				} else {
					// handle a dashboard variable explicitly (for frontend case)
					if strings.HasPrefix(q.AssetName, "${") {
						cdq.AssetQueries = append(cdq.AssetQueries, assetQuery{
							DashboardVariableName: q.AssetName,
						})
					} else {
						// handle backend case where a dashbaord variable was interpolated in
						assetNames := strings.Split(q.AssetName, ",")
						for _, assetName := range assetNames {
							if assetName != "" {
								cdq.AssetQueries = append(cdq.AssetQueries, assetQuery{
									AssetName:   assetName,
									NameAsRegex: true,
								})
							}
						}
					}

				}

				if q.RunId != "" {
					cdq.RunQueries = []runQuery{
						{
							RunId:    q.RunId,
							AsSelect: true,
						},
					}
				} else if q.RunName != "" {
					cdq.RunQueries = []runQuery{
						{
							RunName:     q.RunName,
							NameAsRegex: true,
						},
					}
				}

				migratedInput.ChannelDataQueries = append(migratedInput.ChannelDataQueries, cdq)
				queryGroups[key] = len(migratedInput.ChannelDataQueries) - 1
			}
		}
	} else {
		cdq := channelDataQuery{
			CalculatedChannelQueries: []calculatedChannelQuery{
				{
					Name: input.CalculatedChannelQuery.Name,
					ChannelReferences: func() []channelReferenceQuery {
						var references []channelReferenceQuery
						for _, ref := range input.CalculatedChannelQuery.ChannelReferences {
							references = append(references, channelReferenceQuery{
								ChannelReference: ref.ChannelReference,
								channelQuery: queryToChannelQuery(legacySubQuery{
									ChannelId:         ref.ChannelId,
									ChannelIdentifier: ref.ChannelIdentifier,
								}),
							})
						}
						return references
					}(),
					Expression: input.CalculatedChannelQuery.Expression,
				},
			},
		}

		if input.CalculatedChannelQuery.Asset.AssetId != "" {
			cdq.AssetQueries = []assetQuery{
				{
					AssetId:     input.CalculatedChannelQuery.Asset.AssetId,
					NameAsRegex: false,
					AsSelect:    true,
				},
			}
		} else {
			// handle multiple names from grafana dashboard variables
			assetNames := strings.Split(input.CalculatedChannelQuery.Asset.AssetName, ",")
			for _, assetName := range assetNames {
				if assetName != "" {
					cdq.AssetQueries = []assetQuery{
						{
							AssetName:   assetName,
							NameAsRegex: true,
						},
					}
				}
			}
		}

		if input.RunId != "" {
			cdq.RunQueries = []runQuery{
				{
					RunId:    input.RunId,
					AsSelect: true,
				},
			}
		} else if input.RunName != "" {
			cdq.RunQueries = []runQuery{
				{
					RunName:     input.RunName,
					NameAsRegex: true,
				},
			}
		}

		migratedInput.ChannelDataQueries = append(migratedInput.ChannelDataQueries, cdq)
	}
	log.DefaultLogger.Info("migrated query", "query", migratedInput)
	return migratedInput, nil
}

// handleMigrateQuery handles the migration of a query using SiftDatasource.
func (d *SiftDatasource) callResourceMigrateQuery(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if req.Method != http.MethodPost {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusNotFound,
		})
	}
	input, err := convertQueryIfNeeded(req.Body)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadRequest,
			Body:   []byte(fmt.Sprintf("migrate query: %s", err)),
		})
	}

	respBody, err := json.Marshal(input)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusInternalServerError,
			Body:   []byte(fmt.Sprintf("encode response: %s", err)),
		})
	}

	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusOK,
		Body:   respBody,
	})
}

func queryToChannelQuery(q legacySubQuery) channelQuery {
	if q.ChannelId != "" {
		return channelQuery{
			ChannelId: q.ChannelId,
			AsSelect:  true,
		}
	}
	return channelQuery{
		ChannelName: q.ChannelIdentifier,
		NameAsRegex: true,
	}
}
