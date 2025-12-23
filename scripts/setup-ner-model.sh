#!/bin/bash
#
# NER Model Setup Script
# Exports a Hugging Face NER model to ONNX format and optionally uploads to HF Hub
#
# Usage:
#   ./scripts/setup-ner-model.sh [options]
#
# Options:
#   --quantize       Create quantized model version
#   --upload         Upload to Hugging Face Hub
#   --repo <name>    HF repo name (default: elanlanguages/xlm-roberta-base-ner-hrl-onnx)
#   --model <id>     Source model ID (default: Davlan/xlm-roberta-base-ner-hrl)
#
# Examples:
#   ./scripts/setup-ner-model.sh                           # Export only
#   ./scripts/setup-ner-model.sh --quantize                # Export with quantization
#   ./scripts/setup-ner-model.sh --quantize --upload       # Export, quantize, and upload
#

set -e

# Configuration
DEFAULT_MODEL="Davlan/xlm-roberta-base-ner-hrl"
DEFAULT_REPO="tjruesch/xlm-roberta-base-ner-hrl-onnx"
MODEL_ID="$DEFAULT_MODEL"
HF_REPO="$DEFAULT_REPO"
QUANTIZE=false
UPLOAD=false
OUTPUT_DIR="./models/ner-export"
VENV_DIR="./.ner-setup-venv"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quantize)
      QUANTIZE=true
      shift
      ;;
    --upload)
      UPLOAD=true
      shift
      ;;
    --repo)
      HF_REPO="$2"
      shift 2
      ;;
    --model)
      MODEL_ID="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           NER Model Setup for Bridge Anonymization         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is required but not installed.${NC}"
    echo "Please install Python 3.8+ and try again."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo -e "${GREEN}✓${NC} Found Python ${PYTHON_VERSION}"

# Check Python version >= 3.8
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 8 ]); then
    echo -e "${RED}Error: Python 3.8+ is required (found ${PYTHON_VERSION})${NC}"
    exit 1
fi

echo -e "${BLUE}Source Model:${NC} ${MODEL_ID}"
echo -e "${BLUE}Output:${NC} ${OUTPUT_DIR}"
echo -e "${BLUE}Quantize:${NC} ${QUANTIZE}"
echo -e "${BLUE}Upload:${NC} ${UPLOAD}"
if [ "$UPLOAD" = true ]; then
    echo -e "${BLUE}HF Repo:${NC} ${HF_REPO}"
fi
echo ""

# Check HF login if uploading
if [ "$UPLOAD" = true ]; then
    if ! command -v huggingface-cli &> /dev/null; then
        echo -e "${YELLOW}→${NC} huggingface-cli not found, will install..."
    else
        if ! huggingface-cli whoami &> /dev/null; then
            echo -e "${RED}Error: Not logged into Hugging Face.${NC}"
            echo "Please run: huggingface-cli login"
            exit 1
        fi
        HF_USER=$(huggingface-cli whoami 2>/dev/null | head -n1)
        echo -e "${GREEN}✓${NC} Logged into Hugging Face as: ${HF_USER}"
    fi
fi

# Create output directory structure for HF
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/onnx"

# Create temporary virtual environment
echo -e "${YELLOW}→${NC} Creating temporary Python environment..."
python3 -m venv "$VENV_DIR"

# Activate venv
source "$VENV_DIR/bin/activate"

# Upgrade pip quietly
pip install --quiet --upgrade pip

# Install dependencies with pinned compatible versions
echo -e "${YELLOW}→${NC} Installing dependencies (this may take a minute)..."
pip install --quiet \
    "torch>=2.0.0,<2.5.0" \
    "optimum[onnxruntime]==1.17.1" \
    "transformers==4.38.2" \
    "onnx>=1.15.0" \
    "onnxruntime>=1.17.0" \
    "huggingface_hub>=0.20.0" \
    "sentencepiece" \
    "protobuf"

# Export model to ONNX (to temp directory first)
TEMP_EXPORT="$OUTPUT_DIR/.temp-export"
echo -e "${YELLOW}→${NC} Exporting model to ONNX format..."
python3 << EOF
from optimum.onnxruntime import ORTModelForTokenClassification
from transformers import AutoTokenizer

print("  Loading model from ${MODEL_ID}...")
model = ORTModelForTokenClassification.from_pretrained(
    "${MODEL_ID}",
    export=True
)

# Use slow tokenizer to avoid conversion bug in newer transformers
tokenizer = AutoTokenizer.from_pretrained("${MODEL_ID}", use_fast=False)

print("  Saving ONNX model...")
model.save_pretrained("${TEMP_EXPORT}")
tokenizer.save_pretrained("${TEMP_EXPORT}")

# Also create a tokenizer.json for transformers.js compatibility
try:
    from transformers import AutoTokenizer as AT
    fast_tok = AT.from_pretrained("${MODEL_ID}", use_fast=True, legacy=False)
    fast_tok.save_pretrained("${TEMP_EXPORT}")
except Exception as e:
    print(f"  Note: Could not save fast tokenizer: {e}")
    # Download tokenizer.json directly from HF if available
    from huggingface_hub import hf_hub_download
    try:
        hf_hub_download(
            repo_id="${MODEL_ID}",
            filename="tokenizer.json",
            local_dir="${TEMP_EXPORT}",
        )
    except:
        pass

print("  Export complete!")
EOF

# Move model files to onnx subfolder, keep tokenizer files in root
echo -e "${YELLOW}→${NC} Organizing files for Hugging Face..."
mv "$TEMP_EXPORT/model.onnx" "$OUTPUT_DIR/onnx/"

# Copy tokenizer and config files to root
cp "$TEMP_EXPORT/tokenizer.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$TEMP_EXPORT/tokenizer_config.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$TEMP_EXPORT/special_tokens_map.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$TEMP_EXPORT/config.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$TEMP_EXPORT/sentencepiece.bpe.model" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$TEMP_EXPORT/vocab.txt" "$OUTPUT_DIR/" 2>/dev/null || true

# Clean up temp export
rm -rf "$TEMP_EXPORT"

# Quantize if requested
if [ "$QUANTIZE" = true ]; then
    echo -e "${YELLOW}→${NC} Quantizing model (int8 dynamic)..."
    python3 << EOF
from onnxruntime.quantization import quantize_dynamic, QuantType
import os

model_path = "${OUTPUT_DIR}/onnx/model.onnx"
quantized_path = "${OUTPUT_DIR}/onnx/model_quantized.onnx"

quantize_dynamic(
    model_input=model_path,
    model_output=quantized_path,
    weight_type=QuantType.QInt8,
)

# Get file sizes
orig_size = os.path.getsize(model_path) / (1024 * 1024)
quant_size = os.path.getsize(quantized_path) / (1024 * 1024)

print(f"  Original: {orig_size:.1f} MB")
print(f"  Quantized: {quant_size:.1f} MB ({100 * quant_size / orig_size:.0f}% of original)")
EOF
fi

# Generate label map from config
echo -e "${YELLOW}→${NC} Generating label map..."
python3 << EOF
import json
from transformers import AutoConfig

config = AutoConfig.from_pretrained("${MODEL_ID}")

# Build label map from id2label
if hasattr(config, 'id2label'):
    label_map = [config.id2label[i] for i in sorted(config.id2label.keys())]
else:
    # Fallback for models without id2label
    label_map = ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC", "B-MISC", "I-MISC"]

with open("${OUTPUT_DIR}/label_map.json", "w") as f:
    json.dump(label_map, f, indent=2)

print(f"  Labels: {label_map}")
EOF

# Create README.md with model card
echo -e "${YELLOW}→${NC} Creating README.md..."

# Pass variables to Python via environment to avoid shell escaping issues
QUANTIZE_FLAG="$QUANTIZE" \
MODEL_ID_VAR="$MODEL_ID" \
HF_REPO_VAR="$HF_REPO" \
OUTPUT_DIR_VAR="$OUTPUT_DIR" \
python3 << 'PYEOF'
import os

quantize = os.environ.get("QUANTIZE_FLAG") == "true"
model_id = os.environ.get("MODEL_ID_VAR")
hf_repo = os.environ.get("HF_REPO_VAR")
output_dir = os.environ.get("OUTPUT_DIR_VAR")

# Calculate sizes
model_size = os.path.getsize(f"{output_dir}/onnx/model.onnx") / (1024 * 1024)
quant_size = None
quant_path = f"{output_dir}/onnx/model_quantized.onnx"
if quantize and os.path.exists(quant_path):
    quant_size = os.path.getsize(quant_path) / (1024 * 1024)

readme = f"""---
language:
- multilingual
- en
- de
- es
- fr
- it
- pt
- nl
license: mit
library_name: onnx
tags:
- onnx
- token-classification
- ner
- xlm-roberta
- transformers.js
base_model: {model_id}
pipeline_tag: token-classification
---

# XLM-RoBERTa NER (ONNX)

ONNX export of [{model_id}](https://huggingface.co/{model_id}) for use with ONNX Runtime, Transformers.js, and bridge-anonymization.

## Models

| Model | Size | Description |
|-------|------|-------------|
| onnx/model.onnx | {model_size:.0f} MB | Full precision FP32 |
"""

if quant_size:
    readme += f"""| onnx/model_quantized.onnx | {quant_size:.0f} MB | Quantized INT8 (~4x smaller) |
"""

readme += f"""
## Supported Entity Types

- **PER** - Person names
- **ORG** - Organizations
- **LOC** - Locations
- **DATE** - Dates (if supported by base model)

## Supported Languages

English, German, Spanish, French, Italian, Portuguese, Dutch, and more.

## Usage with bridge-anonymization

See the [bridge-anonymization documentation](https://github.com/elanlanguages/bridge-anonymization) for usage instructions.

## License

MIT License - see the base model [{model_id}](https://huggingface.co/{model_id}) for original model license.

## Credits

- Original model by [Davlan](https://huggingface.co/Davlan)
- ONNX export by [ELAN Languages](https://github.com/elanlanguages)
"""

with open(f"{output_dir}/README.md", "w") as f:
    f.write(readme)

print("  README.md created")
PYEOF

# Create .gitattributes for LFS
echo -e "${YELLOW}→${NC} Creating .gitattributes..."
cat > "$OUTPUT_DIR/.gitattributes" << 'EOF'
*.onnx filter=lfs diff=lfs merge=lfs -text
*.bin filter=lfs diff=lfs merge=lfs -text
*.safetensors filter=lfs diff=lfs merge=lfs -text
sentencepiece.bpe.model filter=lfs diff=lfs merge=lfs -text
EOF

# Upload to Hugging Face if requested
if [ "$UPLOAD" = true ]; then
    echo ""
    echo -e "${YELLOW}→${NC} Uploading to Hugging Face Hub..."
    
    python3 << EOF
from huggingface_hub import HfApi, create_repo
import os

api = HfApi()
repo_id = "${HF_REPO}"

# Create repo if it doesn't exist
try:
    create_repo(repo_id, repo_type="model", exist_ok=True)
    print(f"  Repository: https://huggingface.co/{repo_id}")
except Exception as e:
    print(f"  Note: {e}")

# Upload the folder
print("  Uploading files...")
api.upload_folder(
    folder_path="${OUTPUT_DIR}",
    repo_id=repo_id,
    repo_type="model",
)
print("  Upload complete!")
EOF
fi

# Cleanup
echo -e "${YELLOW}→${NC} Cleaning up..."
deactivate
rm -rf "$VENV_DIR"

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete! ✓                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Model files saved to: ${BLUE}${OUTPUT_DIR}/${NC}"
echo ""
echo "Files created:"
find "$OUTPUT_DIR" -type f | while read file; do
    size=$(ls -lh "$file" | awk '{print $5}')
    relpath="${file#$OUTPUT_DIR/}"
    echo "  $relpath ($size)"
done
echo ""

if [ "$UPLOAD" = true ]; then
    echo -e "Model uploaded to: ${BLUE}https://huggingface.co/${HF_REPO}${NC}"
    echo ""
    echo -e "Update your model-manager.ts to use:"
    echo -e "  ${YELLOW}hfRepo: '${HF_REPO}'${NC}"
else
    echo -e "To upload to Hugging Face, run:"
    echo -e "  ${YELLOW}npm run setup:ner:upload${NC}"
fi
echo ""
