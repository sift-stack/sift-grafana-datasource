#!/bin/bash

# Configuration
MIN_REBUILD_INTERVAL=10  # Minimum seconds between rebuilds
CONTAINER_NAME="sift-grafana-datasource"
RESTART_DELAY=2  # Seconds to wait after rebuild before restarting Grafana

# Variables
last_rebuild_time=0

# Function to rebuild the plugin and restart Grafana
rebuild_and_restart() {
  current_time=$(date +%s)
  time_since_last_rebuild=$((current_time - last_rebuild_time))
  
  if [ $time_since_last_rebuild -lt $MIN_REBUILD_INTERVAL ]; then
    echo "Skipping rebuild - last rebuild was $time_since_last_rebuild seconds ago (minimum interval: $MIN_REBUILD_INTERVAL seconds)"
    return
  fi
  
  echo "Rebuilding plugin using mage..."
  mage -v
  build_result=$?
  last_rebuild_time=$(date +%s)
  
  if [ $build_result -eq 0 ]; then
    echo "Build successful at $(date)"
    echo "Waiting $RESTART_DELAY seconds before restarting Grafana..."
    sleep $RESTART_DELAY
    
    echo "Restarting Grafana container..."
    docker restart $CONTAINER_NAME
    echo "Grafana container restarted"
  else
    echo "Build failed with exit code $build_result"
  fi
}

# Initial build and restart
echo "Performing initial build..."
rebuild_and_restart

# Watch for changes
echo "Watching for changes in pkg directory..."
echo "Minimum rebuild interval: $MIN_REBUILD_INTERVAL seconds"
echo "Press Ctrl+C to stop watching"

# Use fswatch if available, otherwise fallback to a simple polling approach
if command -v fswatch > /dev/null; then
  echo "Using fswatch for file monitoring"
  fswatch -o ./pkg | while read f; do
    echo "Change detected in $f"
    rebuild_and_restart
  done
else
  # Fallback to a simple polling approach
  echo "fswatch not found, using simple polling (install fswatch for better performance)"
  last_hash=$(find ./pkg -type f -name "*.go" -exec md5 {} \; | sort | md5)
  
  while true; do
    sleep 2  # Check every 2 seconds
    current_hash=$(find ./pkg -type f -name "*.go" -exec md5 {} \; | sort | md5)
    if [ "$last_hash" != "$current_hash" ]; then
      echo "Change detected"
      rebuild_and_restart
      last_hash=$current_hash
    fi
  done
fi
