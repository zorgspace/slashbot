#!/bin/bash
WEATHER=$(curl -s 'wttr.in/San+Francisco?format=%C+%t')
echo "$(date '+%Y-%m-%d %H:%M:%S'): SF Weather - $WEATHER" >> ~/sf-weather.log