#!/bin/bash

echo "Stopping all services..."

# Kill Ollama screen session
if screen -ls | grep -q "llm"; then
    screen -S llm -X quit
    echo "Ollama stopped"
else
    echo "Ollama not running"
fi

# Kill any remaining Ollama processes
pkill -f "ollama serve" 2>/dev/null
pkill -f "ollama run" 2>/dev/null

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
screen -ls | grep -E "(llm|backend|frontend)" || echo "None"
