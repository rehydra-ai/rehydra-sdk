#!/bin/bash
# Test that the browser bundle doesn't include Node.js modules
# This mirrors the CI browser-bundle job

set -e

echo "🔨 Building package..."
npm run build

echo "📦 Creating test project..."
rm -rf test-browser-build
mkdir -p test-browser-build
cd test-browser-build

npm init -y > /dev/null
npm install vite typescript --save-dev --silent
npm link .. --silent

echo "📝 Creating test files..."
cat > test-import.ts << 'EOF'
import { 
  createAnonymizer,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  loadRuntime,
  getStorageProvider,
} from 'rehydra';
console.log('Browser imports work!');
EOF

cat > vite.config.ts << 'EOF'
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    lib: {
      entry: './test-import.ts',
      formats: ['es'],
      fileName: 'test-bundle',
    },
    minify: false,
  },
});
EOF

echo "🏗️  Running Vite build..."
OUTPUT=$(npx vite build 2>&1) || true
echo "$OUTPUT"
echo ""

# Check for Node.js module warnings
FAILED=0

if echo "$OUTPUT" | grep -q "storage-node"; then
  echo "❌ ERROR: storage-node.js is being bundled (should use storage.browser.js)"
  FAILED=1
fi

if echo "$OUTPUT" | grep -q "onnxruntime-node"; then
  echo "❌ ERROR: onnxruntime-node is being bundled (should use onnxruntime-web)"
  FAILED=1
fi

if echo "$OUTPUT" | grep -q '"fs/promises"'; then
  echo "❌ ERROR: fs/promises is being imported (Node.js module in browser build)"
  FAILED=1
fi

if echo "$OUTPUT" | grep -q '"path".*externalized'; then
  echo "❌ ERROR: path module is being imported (Node.js module in browser build)"
  FAILED=1
fi

if echo "$OUTPUT" | grep -q '"node:stream"'; then
  echo "❌ ERROR: node:stream is being imported (Node.js module in browser build)"
  FAILED=1
fi

if echo "$OUTPUT" | grep -q '"node:http"'; then
  echo "❌ ERROR: node:http is being imported (Node.js module in browser build)"
  FAILED=1
fi

# Cleanup
cd ..
rm -rf test-browser-build

if [ $FAILED -eq 1 ]; then
  echo ""
  echo "❌ Browser bundle test FAILED"
  exit 1
else
  echo "✅ Browser bundle test PASSED - no Node.js modules detected"
  exit 0
fi

