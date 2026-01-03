"""
ONNX Runtime Inference Engine with TensorRT optimization
"""

import os
import numpy as np
import onnxruntime as ort
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class NERInferenceEngine:
    """
    NER inference engine using ONNX Runtime with TensorRT acceleration.
    
    Falls back to CUDA, then CPU if TensorRT is unavailable.
    """
    
    def __init__(
        self,
        model_path: str = "/models/model.onnx",
        trt_cache_path: str = "/models/trt_cache",
        enable_fp16: bool = True,
    ):
        self.model_path = model_path
        self.trt_cache_path = trt_cache_path
        self.enable_fp16 = enable_fp16
        self.session: Optional[ort.InferenceSession] = None
        self.is_ready = False
        self.active_provider = ""
    
    async def load_model(self) -> None:
        """Load the ONNX model with TensorRT optimization"""
        logger.info(f"Loading model from {self.model_path}")
        
        # Ensure TRT cache directory exists
        os.makedirs(self.trt_cache_path, exist_ok=True)
        
        # Available providers (in priority order)
        available_providers = ort.get_available_providers()
        logger.info(f"Available ONNX Runtime providers: {available_providers}")
        
        # Build provider list with options
        providers = []
        
        # Try TensorRT first
        if 'TensorrtExecutionProvider' in available_providers:
            trt_options = {
                'trt_fp16_enable': self.enable_fp16,
                'trt_engine_cache_enable': True,
                'trt_engine_cache_path': self.trt_cache_path,
                'trt_max_workspace_size': 2 * 1024 * 1024 * 1024,  # 2GB
                'trt_builder_optimization_level': 3,  # Max optimization
            }
            providers.append(('TensorrtExecutionProvider', trt_options))
            logger.info("TensorRT provider configured")
        
        # CUDA fallback
        if 'CUDAExecutionProvider' in available_providers:
            cuda_options = {
                'device_id': 0,
                'arena_extend_strategy': 'kSameAsRequested',
            }
            providers.append(('CUDAExecutionProvider', cuda_options))
            logger.info("CUDA provider configured as fallback")
        
        # CPU fallback (always available)
        providers.append('CPUExecutionProvider')
        
        # Create session
        logger.info("Creating ONNX Runtime inference session...")
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        self.session = ort.InferenceSession(
            self.model_path,
            sess_options=sess_options,
            providers=providers
        )
        
        # Check which provider is actually being used
        active_providers = self.session.get_providers()
        self.active_provider = active_providers[0] if active_providers else "Unknown"
        logger.info(f"Active providers: {active_providers}")
        logger.info(f"Primary provider: {self.active_provider}")
        
        # Warmup runs to trigger TensorRT engine compilation
        logger.info("Running warmup inference (this may take a few minutes for TensorRT compilation)...")
        dummy_input_ids = np.ones((1, 128), dtype=np.int64)
        dummy_attention_mask = np.ones((1, 128), dtype=np.int64)
        
        for i in range(3):
            _ = self.session.run(
                None,
                {
                    'input_ids': dummy_input_ids,
                    'attention_mask': dummy_attention_mask,
                }
            )
            logger.info(f"Warmup run {i + 1}/3 completed")
        
        self.is_ready = True
        logger.info(f"Model loaded and ready! Using {self.active_provider}")
    
    async def infer(self, input_ids: list, attention_mask: list) -> np.ndarray:
        """
        Run inference on the model.
        
        Args:
            input_ids: List of token IDs
            attention_mask: List of attention mask values
            
        Returns:
            Logits array of shape [1, seq_length, num_labels]
        """
        if not self.is_ready or self.session is None:
            raise RuntimeError("Model not loaded. Call load_model() first.")
        
        # Convert to numpy arrays with batch dimension
        inputs = {
            'input_ids': np.array([input_ids], dtype=np.int64),
            'attention_mask': np.array([attention_mask], dtype=np.int64),
        }
        
        # Run inference
        outputs = self.session.run(None, inputs)
        
        # Return first output (logits)
        return outputs[0]

