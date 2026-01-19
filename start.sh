#!/bin/bash

# Unified Service Startup Script
# Usage: ./start.sh [all|llm|assistant|stop|status|restart]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VLLM_ENV="$HOME/dev/vllm-env"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# Start Ollama server (qwen3-coder:30b on A6000)
start_llm() {
    echo "Starting Ollama server..."
    screen -dmS llm bash -c "
        export CUDA_VISIBLE_DEVICES=1
        ollama serve 2>&1 | tee '$LOG_DIR/llm.log'
    "
    echo "Waiting for Ollama to start..."
    sleep 3
    # Preload the model to keep it in memory
    echo "Preloading qwen3-coder:30b model..."
    CUDA_VISIBLE_DEVICES=1 ollama run qwen3-coder:30b --keepalive 24h "" >/dev/null 2>&1 &
    echo "Ollama started in screen 'llm' (port 11434)"
}

# Start assistant backend
start_backend() {
    echo "Starting assistant backend..."
    screen -dmS backend bash -c "cd '$SCRIPT_DIR/backend' && ./start.sh; exec bash"
    echo "Backend started in screen 'backend' (port 8001)"
}

# Start assistant frontend
start_frontend() {
    echo "Starting assistant frontend..."
    screen -dmS frontend bash -c "cd '$SCRIPT_DIR/frontend' && bun install && bun run dev; exec bash"
    echo "Frontend started in screen 'frontend' (port 5173)"
}

# Stop all services
stop_all() {
    echo "Stopping all services..."
    screen -S llm -X quit 2>/dev/null
    screen -S backend -X quit 2>/dev/null
    screen -S frontend -X quit 2>/dev/null
    pkill -f "ollama serve" 2>/dev/null
    pkill -f "ollama run" 2>/dev/null
    echo "Done."
}

# Show status
status() {
    echo "=== GPU Status ==="
    nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv
    echo ""
    echo "=== Screen Sessions ==="
    screen -ls | grep -E "(llm|backend|frontend)" || echo "No active sessions"
    echo ""
    echo "=== Service Health ==="
    curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && echo "Ollama (11434): UP" || echo "Ollama (11434): DOWN"
    curl -sk https://localhost:8001/health >/dev/null 2>&1 && echo "Backend (8001): UP" || echo "Backend (8001): DOWN"
    curl -sk https://localhost:5173 >/dev/null 2>&1 && echo "Frontend (5173): UP" || echo "Frontend (5173): DOWN"
}

case "${1:-all}" in
    llm)
        start_llm
        ;;
    assistant)
        start_backend
        start_frontend
        ;;
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    all)
        start_llm
        echo "Waiting for vLLM to initialize..."
        sleep 5
        start_backend
        start_frontend
        echo ""
        echo "All services starting. Use './start.sh status' to check."
        ;;
    stop)
        stop_all
        ;;
    status)
        status
        ;;
    restart)
        stop_all
        sleep 2
        start_llm
        sleep 5
        start_backend
        start_frontend
        ;;
    *)
        echo "Usage: $0 [all|llm|assistant|stop|status|restart]"
        echo ""
        echo "  all       - Start all services (Ollama + backend + frontend)"
        echo "  llm       - Start only Ollama server (port 11434)"
        echo "  assistant - Start only assistant (backend + frontend)"
        echo "  backend   - Start only backend (port 8001)"
        echo "  frontend  - Start only frontend (port 5173)"
        echo "  stop      - Stop all services"
        echo "  status    - Show service status"
        echo "  restart   - Restart all services"
        exit 1
        ;;
esac
