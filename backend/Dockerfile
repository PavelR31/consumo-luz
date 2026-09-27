FROM python:3.14-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Install system dependencies required for EasyOCR, PyMySQL, and cryptography
RUN apt-get update && apt-get install -y \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    default-libmysqlclient-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (install PyTorch CPU-only first to prevent downloading 4.5GB of unused NVIDIA CUDA libs)
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app/

# Expose port for FastAPI
EXPOSE 8000

# Command to run the application (overridden in docker-compose for the bot)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]