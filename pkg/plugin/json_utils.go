package plugin

import (
	"encoding/json"
	"math"
	"time"
)

func (fv *floatValue) UnmarshalJSON(data []byte) error {
	// Define an alias type to avoid infinite recursion
	type Alias floatValue

	// Create an intermediate struct with a raw message for the value
	aux := struct {
		Timestamp time.Time       `json:"timestamp"`
		Value     json.RawMessage `json:"value"`
	}{}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	// Set the timestamp
	fv.Timestamp = aux.Timestamp

	// Handle the value field specially
	switch string(aux.Value) {
	case `"NaN"`:
		fv.Value = float32(math.NaN())
	case `"Inf"`, `"Infinity"`:
		fv.Value = float32(math.Inf(1))
	case `"-Inf"`, `"-Infinity"`:
		fv.Value = float32(math.Inf(-1))
	default:
		var v float32
		if err := json.Unmarshal(aux.Value, &v); err != nil {
			return err
		}
		fv.Value = v
	}

	return nil
}

func (dv *doubleValue) UnmarshalJSON(data []byte) error {
	// Define an alias type to avoid infinite recursion
	type Alias doubleValue

	// Create an intermediate struct with a raw message for the value
	aux := struct {
		Timestamp time.Time       `json:"timestamp"`
		Value     json.RawMessage `json:"value"`
	}{}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	// Set the timestamp
	dv.Timestamp = aux.Timestamp

	// Handle the value field specially
	switch string(aux.Value) {
	case `"NaN"`:
		dv.Value = math.NaN()
	case `"Inf"`, `"Infinity"`:
		dv.Value = math.Inf(1)
	case `"-Inf"`, `"-Infinity"`:
		dv.Value = math.Inf(-1)
	default:
		var v float64
		if err := json.Unmarshal(aux.Value, &v); err != nil {
			return err
		}
		dv.Value = v
	}

	return nil
}
