#!/bin/bash
CITY=${CITY:-Paris}
echo "$(date '+%Y-%m-%d %H:%M:%S'): Fetching weather for $CITY..."
WEATHER=$(curl -s "wttr.in/$CITY?format=%l:+%C+%t")
echo "$WEATHER" | tee -a weather.log