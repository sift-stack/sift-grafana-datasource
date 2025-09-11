package plugin

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestFloatValue_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name     string
		jsonData string
		want     float32
		wantErr  bool
	}{
		{
			name:     "regular float value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 3.14}`,
			want:     3.14,
			wantErr:  false,
		},
		{
			name:     "NaN value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "NaN"}`,
			want:     float32(math.NaN()),
			wantErr:  false,
		},
		{
			name:     "positive infinity",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "Inf"}`,
			want:     float32(math.Inf(1)),
			wantErr:  false,
		},
		{
			name:     "positive infinity (Infinity)",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "Infinity"}`,
			want:     float32(math.Inf(1)),
			wantErr:  false,
		},
		{
			name:     "negative infinity",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "-Inf"}`,
			want:     float32(math.Inf(-1)),
			wantErr:  false,
		},
		{
			name:     "negative infinity (-Infinity)",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "-Infinity"}`,
			want:     float32(math.Inf(-1)),
			wantErr:  false,
		},
		{
			name:     "zero value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 0}`,
			want:     0,
			wantErr:  false,
		},
		{
			name:     "negative value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": -42.5}`,
			want:     -42.5,
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var fv floatValue
			err := json.Unmarshal([]byte(tt.jsonData), &fv)
			
			if (err != nil) != tt.wantErr {
				t.Errorf("floatValue.UnmarshalJSON() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			
			if !tt.wantErr {
				// Special handling for NaN comparison
				if math.IsNaN(float64(tt.want)) {
					if !math.IsNaN(float64(fv.Value)) {
						t.Errorf("floatValue.UnmarshalJSON() = %v, want NaN", fv.Value)
					}
				} else if fv.Value != tt.want {
					t.Errorf("floatValue.UnmarshalJSON() = %v, want %v", fv.Value, tt.want)
				}
				
				// Check that timestamp was parsed correctly
				expectedTime, _ := time.Parse(time.RFC3339, "2023-01-01T00:00:00Z")
				if !fv.Timestamp.Equal(expectedTime) {
					t.Errorf("floatValue.UnmarshalJSON() timestamp = %v, want %v", fv.Timestamp, expectedTime)
				}
			}
		})
	}
}

func TestDoubleValue_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name     string
		jsonData string
		want     float64
		wantErr  bool
	}{
		{
			name:     "regular double value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 3.141592653589793}`,
			want:     3.141592653589793,
			wantErr:  false,
		},
		{
			name:     "NaN value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "NaN"}`,
			want:     math.NaN(),
			wantErr:  false,
		},
		{
			name:     "positive infinity",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "Inf"}`,
			want:     math.Inf(1),
			wantErr:  false,
		},
		{
			name:     "positive infinity (Infinity)",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "Infinity"}`,
			want:     math.Inf(1),
			wantErr:  false,
		},
		{
			name:     "negative infinity",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "-Inf"}`,
			want:     math.Inf(-1),
			wantErr:  false,
		},
		{
			name:     "negative infinity (-Infinity)",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": "-Infinity"}`,
			want:     math.Inf(-1),
			wantErr:  false,
		},
		{
			name:     "zero value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 0}`,
			want:     0,
			wantErr:  false,
		},
		{
			name:     "negative value",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": -123.456789}`,
			want:     -123.456789,
			wantErr:  false,
		},
		{
			name:     "very large number",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 1.7976931348623157e+308}`,
			want:     1.7976931348623157e+308,
			wantErr:  false,
		},
		{
			name:     "very small number",
			jsonData: `{"timestamp": "2023-01-01T00:00:00Z", "value": 2.2250738585072014e-308}`,
			want:     2.2250738585072014e-308,
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var dv doubleValue
			err := json.Unmarshal([]byte(tt.jsonData), &dv)
			
			if (err != nil) != tt.wantErr {
				t.Errorf("doubleValue.UnmarshalJSON() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			
			if !tt.wantErr {
				// Special handling for NaN comparison
				if math.IsNaN(tt.want) {
					if !math.IsNaN(dv.Value) {
						t.Errorf("doubleValue.UnmarshalJSON() = %v, want NaN", dv.Value)
					}
				} else if dv.Value != tt.want {
					t.Errorf("doubleValue.UnmarshalJSON() = %v, want %v", dv.Value, tt.want)
				}
				
				// Check that timestamp was parsed correctly
				expectedTime, _ := time.Parse(time.RFC3339, "2023-01-01T00:00:00Z")
				if !dv.Timestamp.Equal(expectedTime) {
					t.Errorf("doubleValue.UnmarshalJSON() timestamp = %v, want %v", dv.Timestamp, expectedTime)
				}
			}
		})
	}
}

func TestFloatValue_UnmarshalJSON_Array(t *testing.T) {
	jsonData := `[
		{"timestamp": "2023-01-01T00:00:00Z", "value": 1.5},
		{"timestamp": "2023-01-01T00:01:00Z", "value": "NaN"},
		{"timestamp": "2023-01-01T00:02:00Z", "value": "Inf"},
		{"timestamp": "2023-01-01T00:03:00Z", "value": "-Infinity"}
	]`
	
	var values []floatValue
	err := json.Unmarshal([]byte(jsonData), &values)
	if err != nil {
		t.Fatalf("Failed to unmarshal array: %v", err)
	}
	
	if len(values) != 4 {
		t.Fatalf("Expected 4 values, got %d", len(values))
	}
	
	// Test regular value
	if values[0].Value != 1.5 {
		t.Errorf("Expected first value to be 1.5, got %v", values[0].Value)
	}
	
	// Test NaN
	if !math.IsNaN(float64(values[1].Value)) {
		t.Errorf("Expected second value to be NaN, got %v", values[1].Value)
	}
	
	// Test positive infinity
	if !math.IsInf(float64(values[2].Value), 1) {
		t.Errorf("Expected third value to be +Inf, got %v", values[2].Value)
	}
	
	// Test negative infinity
	if !math.IsInf(float64(values[3].Value), -1) {
		t.Errorf("Expected fourth value to be -Inf, got %v", values[3].Value)
	}
}

func TestDoubleValue_UnmarshalJSON_Array(t *testing.T) {
	jsonData := `[
		{"timestamp": "2023-01-01T00:00:00Z", "value": 3.141592653589793},
		{"timestamp": "2023-01-01T00:01:00Z", "value": "NaN"},
		{"timestamp": "2023-01-01T00:02:00Z", "value": "Inf"},
		{"timestamp": "2023-01-01T00:03:00Z", "value": "-Infinity"}
	]`
	
	var values []doubleValue
	err := json.Unmarshal([]byte(jsonData), &values)
	if err != nil {
		t.Fatalf("Failed to unmarshal array: %v", err)
	}
	
	if len(values) != 4 {
		t.Fatalf("Expected 4 values, got %d", len(values))
	}
	
	// Test regular value
	if values[0].Value != 3.141592653589793 {
		t.Errorf("Expected first value to be 3.141592653589793, got %v", values[0].Value)
	}
	
	// Test NaN
	if !math.IsNaN(values[1].Value) {
		t.Errorf("Expected second value to be NaN, got %v", values[1].Value)
	}
	
	// Test positive infinity
	if !math.IsInf(values[2].Value, 1) {
		t.Errorf("Expected third value to be +Inf, got %v", values[2].Value)
	}
	
	// Test negative infinity
	if !math.IsInf(values[3].Value, -1) {
		t.Errorf("Expected fourth value to be -Inf, got %v", values[3].Value)
	}
}
