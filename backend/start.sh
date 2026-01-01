#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies if needed
if [ ! -f "venv/.installed" ]; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
    touch venv/.installed
fi

# Set cuDNN library path
export LD_LIBRARY_PATH="$SCRIPT_DIR/venv/lib/python3.11/site-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH"

# Run the backend
echo "Starting backend server..."
python main.py
