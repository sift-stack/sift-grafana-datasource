package plugin

import (
	"context"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// CheckHealth handles health checks sent from Grafana to the plugin.
// The main use case for these health checks is the test button on the
// datasource configuration page which allows users to verify that
// a datasource is working as expected.
func (d *SiftDatasource) CheckHealth(_ context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	u, err := getApiUrl(req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("error getting api url: %v", err.Error()),
		}, nil
	}
	u.Path = "/api/v1/me"
	request, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("error creating request: %v", err.Error()),
		}, nil
	}
	request.Header.Set("Authorization", "Bearer "+req.PluginContext.DataSourceInstanceSettings.DecryptedSecureJSONData["apiKey"])
	resp, err := http.DefaultClient.Do(request)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("error querying backend: %v", err.Error()),
		}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("Sift API returned an error: %v", resp.Status),
		}, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Successfully connected to the Sift API",
	}, nil
}
