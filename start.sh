#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting services..."

# Start backend in a screen session
screen -dmS backend bash -c "cd '$SCRIPT_DIR/backend' && ./start.sh; exec bash"
echo "Backend started in screen 'backend'"

# Start frontend in a screen session
screen -dmS frontend bash -c "cd '$SCRIPT_DIR/frontend' && bun install && bun run dev; exec bash"
echo "Frontend started in screen 'frontend'"

echo ""
echo "Active screens:"
screen -ls | grep -E "(backend|frontend)"

echo ""
echo "To attach: screen -r <name>"
echo "To detach: Ctrl+A, D"
echo "To stop:   ./stop.sh"
