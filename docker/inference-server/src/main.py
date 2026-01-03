"""
Rehydra NER Inference Service
FastAPI application for GPU-accelerated NER inference
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .inference import NERInferenceEngine
from .models import InferRequest, InferResponse, HealthResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global engine instance
engine: NERInferenceEngine = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - loads model on startup"""
    global engine
    
    # Get configuration from environment
    model_path = os.environ.get('MODEL_PATH', '/models/model.onnx')
    trt_cache_path = os.environ.get('TRT_CACHE_PATH', '/models/trt_cache')
    enable_fp16 = os.environ.get('ENABLE_FP16', 'true').lower() == 'true'
    
    logger.info(f"Initializing inference engine...")
    logger.info(f"  Model path: {model_path}")
    logger.info(f"  TRT cache: {trt_cache_path}")
    logger.info(f"  FP16 enabled: {enable_fp16}")
    
    engine = NERInferenceEngine(
        model_path=model_path,
        trt_cache_path=trt_cache_path,
        enable_fp16=enable_fp16,
    )
    
    await engine.load_model()
    logger.info("Inference engine ready!")
    
    yield
    
    # Cleanup on shutdown
    logger.info("Shutting down inference engine...")


# Create FastAPI app
app = FastAPI(
    title="Rehydra NER Inference Service",
    description="GPU-accelerated Named Entity Recognition inference using ONNX Runtime with TensorRT",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware for SDK access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy" if engine and engine.is_ready else "not_ready",
        model_loaded=engine.is_ready if engine else False,
        provider=engine.active_provider if engine else "",
    )


@app.post("/v1/infer", response_model=InferResponse)
async def infer(request: InferRequest):
    """
    Run NER inference on tokenized input.
    
    Expects pre-tokenized input (input_ids and attention_mask).
    Returns raw logits for post-processing by the SDK.
    """
    if not engine or not engine.is_ready:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Service is starting up."
        )
    
    try:
        # Run inference
        logits = await engine.infer(request.input_ids, request.attention_mask)
        
        return InferResponse(
            logits=logits[0].tolist(),  # Remove batch dimension, convert to list
            shape=list(logits.shape[1:]),  # Shape without batch: [seq_length, num_labels]
        )
    except Exception as e:
        logger.error(f"Inference error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Inference failed: {str(e)}"
        )


@app.get("/")
async def root():
    """Root endpoint with service info"""
    return {
        "service": "Rehydra NER Inference",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }

