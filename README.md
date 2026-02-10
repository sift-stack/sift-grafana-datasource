# Sift Grafana Datasource

[![Grafana 11](https://img.shields.io/badge/Grafana-11.0.0%2B-orange)](https://grafana.com)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/sift-stack/sift-grafana-datasource)](https://github.com/sift-stack/sift-grafana-datasource/releases)

## Overview

This is a Grafana datasource plugin for [Sift](https://www.siftstack.com/). It allows you to query Sift for data and visualize it in Grafana dashboards. The plugin supports both simple channel queries and calculated channel expressions.

<img alt="Grafana Query Screenshot - Channel Query" src="https://raw.githubusercontent.com/sift-stack/sift-grafana-datasource/main/src/img/channel-query.png" width="400">

<img alt="Grafana Query Screenshot - Calculated Channel Query" src="https://raw.githubusercontent.com/sift-stack/sift-grafana-datasource/main/src/img/calculated-query.png" width="400">

## Compatibility

This plugin is compatible with Grafana versions `11.0.0` and above.

## User Guide

### Configuration

To configure the plugin, you will need:

1. The Sift REST API endpoint URL
2. A valid Sift API key

Instructions for getting these values can be found in the [Sift documentation](https://docs.siftstack.com/docs/api/how-to-guides/rest/authenticate-with-the-rest-api).
Enter these values when creating the datasource in Grafana.

### Usage

1. Create a dashboard and add a panel
2. Select the Sift data source
3. Click "Add Query" and select either a Channel or Calculated Channel query
4. Configure query
5. Query will be run after selection or clicking outside the input or by clicking the Refresh button
6. Additional Queries can be added using the "Add Query" button to use both Channel and Calculated Channel queries in the same panel

#### Selection Types

Selection of Assets, Runs, and Channels can be done using multiple different input types. Input type may be changed using the "Change input type" button.

- **Selection**: Select from a list of options. Filter down the list by entering a search term. Only 200 will be shown at a time and a search may be required to find a specific option.
- **Text**: Enter the exact name of the Asset, Run, or Channel. This will only return exact matches.
- **ID/Client Key**: Enter the ID or Client Key of the Asset, Run, or Channel.
- **Regex**: Enter a regular expression to find multiple Assets, Runs, or Channels by their name. This may return multiple matches. By default, the query is a substring match.
- **Grafana Variable Selection**: Only available for Assets. Provides a list of Grafana dashboard variables that are Sift Asset Query variables (See below).

Channels and Runs can only use the Selection type when an Asset option has been selected using the Selection dropdown.

#### Grouping

By default, data is combined from multiple Runs into a single trace. To group by Channel and Run , uncheck "Combine Runs".

#### Asset Query Variables

Query variables can be used to dynamically select Assets.

To add an Asset selector to your dashboard:

1. Go to the Dashboard settings
2. Click the "Variables" tab
3. Click "New Variable" button
4. Select variable type "Query"
5. Select Data Source "Sift"
6. Configure remaining options to your preference

The dashboard variable will allow for selecting Multiple, All, or a single Asset. The variable can be selected from the
dashboard variable selector in the query editor for Asset.

#### Other Dashboard Variables

Other dashboard variables can be in any text input field such as name, ID, calculated channel name, or expression.

To use a dashboard variable in a query, enter the name as: `${variableName}`. The variable will be replaced with
the string value of the variable when the query is executed.

#### Caching

To improve performance, queries are cached by panel for a given query and associated interval (sample rate). If the
query range changes, but the query is otherwise the same, only the missing data on either side will be fetched. In the case
where the right side of the query range is close to live, new data will always be queried for data between now and the last 10 minutes.

Asset, Run, and Channel queries are cached to speed up regular expression queries. These caches will expire after 10 minutes.

Both caches may be cleared for a panel by clicking the "Clear cache" button next to the Query Mode selector.

#### Annotations

Annotations are supported and enable querying Sift Annotations or using regular Sift data queries to visualize data, such as enum state changes, as annotations.

## Learn More

- [Sift](https://www.siftstack.com/)
- [Sift Documentation](https://docs.siftstack.com/)
- [Sift Grafana Datasource Repository](https://github.com/sift-stack/sift-grafana-datasource)

## Contributing

Please submit bug reports and pull requests to the [Sift Grafana Datasource](https://github.com/sift-stack/sift-grafana-datasource) repository on GitHub.
