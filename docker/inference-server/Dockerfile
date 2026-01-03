# Rehydra NER Inference Service
# GPU-accelerated inference with ONNX Runtime + TensorRT

FROM nvcr.io/nvidia/pytorch:24.01-py3

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Create model directories
RUN mkdir -p /models /models/trt_cache

# Environment variables
ENV MODEL_PATH=/models/model.onnx
ENV TRT_CACHE_PATH=/models/trt_cache
ENV ENABLE_FP16=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Expose port
EXPOSE 8080

# Run the service
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]

