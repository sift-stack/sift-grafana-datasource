package celUtils

import (
	"fmt"
	"strings"
)

// In generates a CEL expression that checks for `field` membership in `vals`.
func In(field string, vals []string) string {
	if len(vals) == 0 {
		return ""
	}
	quotedVals := make([]string, len(vals))
	for i, val := range vals {
		quotedVals[i] = fmt.Sprintf(`'%s'`, val)
	}
	return fmt.Sprintf("%s in [%s]", field, strings.Join(quotedVals, ","))
}

// Equals generates a CEL expression that checks for equality.
func Equals(key string, value interface{}) string {
	switch v := value.(type) {
	case string:
		return fmt.Sprintf(`%s == '%s'`, key, v)
	case nil:
		return fmt.Sprintf("%s == null", key)
	default:
		return fmt.Sprintf("%s == %v", key, v)
	}
}

// EqualsAll generates a CEL expression that checks for equality of all key-value pairs.
func EqualsAll(values map[string]interface{}) string {
	var clauses []string
	for key, value := range values {
		clauses = append(clauses, Equals(key, value))
	}
	return strings.Join(clauses, " && ")
}

// EqualsDouble generates a CEL expression that checks for equality with a double value.
func EqualsDouble(key string, value interface{}) string {
	if value == nil {
		return fmt.Sprintf("%s == null", key)
	}
	return fmt.Sprintf("%s == double(%v)", key, value)
}

// And generates a CEL expression that joins all clauses with an AND operator.
func And(clauses ...string) string {
	if len(clauses) == 0 {
		return ""
	}
	if len(clauses) == 1 {
		return clauses[0]
	}
	return strings.Join(clauses, " && ")
}

func AndWithParentheses(clauses ...string) string {
	return fmt.Sprintf("(%s)", strings.Join(clauses, " && "))
}

// Or generates a CEL expression that joins all clauses with an OR operator.
func Or(clauses ...string) string {
	if len(clauses) == 0 {
		return ""
	}
	if len(clauses) == 1 {
		return clauses[0]
	}
	return strings.Join(clauses, " || ")
}

func OrWithParentheses(clauses ...string) string {
	return fmt.Sprintf("(%s)", strings.Join(clauses, " || "))
}

// Not generates a CEL expression that negates the given clause.
func Not(clause string) string {
	return fmt.Sprintf("!(%s)", clause)
}

// GreaterThan generates a CEL expression that checks whether a field is greater than a given value.
func GreaterThan(field string, value float64) string {
	return fmt.Sprintf("%s > %v", field, value)
}

// GreaterThanOrEqual generates a CEL expression that checks whether a field is greater than or equal to a given string value.
func GreaterThanOrEqual(field string, value string) string {
	return fmt.Sprintf(`%s >= %s`, field, value)
}

// LessThanOrEqual generates a CEL expression that checks whether a field is less than or equal to a given string value.
func LessThanOrEqual(field string, value string) string {
	return fmt.Sprintf(`%s <= %s`, field, value)
}

// Contains generates a CEL expression that checks whether a string field contains a given value.
func Contains(field, value string) string {
	return fmt.Sprintf(`%s.contains('%s')`, field, value)
}

// Match generates a CEL expression that checks for a match
// on the specified field.
func Match(field, query string) string {
	return fmt.Sprintf(`%s.matches('%s')`, field, query)
}

// MatchRegex is like Match but properly escapes backslashes in regex patterns for CEL
// It adds an extra backslash before any existing backslash in the pattern
func MatchRegex(field, regex string) string {
	// Double-escape any backslashes that already exist in the regex
	escapedRegex := strings.ReplaceAll(regex, "\\", "\\\\")
	return fmt.Sprintf(`%s.matches('%s')`, field, escapedRegex)
}
