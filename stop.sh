#!/bin/bash

echo "Stopping services..."

# Kill backend screen session
if screen -ls | grep -q "backend"; then
    screen -S backend -X quit
    echo "Backend stopped"
else
    echo "Backend not running"
fi

# Kill frontend screen session
if screen -ls | grep -q "frontend"; then
    screen -S frontend -X quit
    echo "Frontend stopped"
else
    echo "Frontend not running"
fi

echo ""
echo "Remaining screens:"
screen -ls | grep -E "(backend|frontend)" || echo "None"
