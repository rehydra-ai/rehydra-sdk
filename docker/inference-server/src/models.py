"""
Pydantic models for the inference API
"""

from pydantic import BaseModel, Field
from typing import List


class InferRequest(BaseModel):
    """Request payload for inference endpoint"""
    input_ids: List[int] = Field(..., description="Tokenized input IDs")
    attention_mask: List[int] = Field(..., description="Attention mask (1 for real tokens, 0 for padding)")


class InferResponse(BaseModel):
    """Response payload from inference endpoint"""
    logits: List[List[float]] = Field(..., description="Model logits output [seq_length, num_labels]")
    shape: List[int] = Field(..., description="Shape of the logits tensor")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    model_loaded: bool = Field(..., description="Whether the model is loaded and ready")
    provider: str = Field(default="", description="Active execution provider (TensorRT, CUDA, or CPU)")

