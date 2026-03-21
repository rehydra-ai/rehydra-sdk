# @rehydra/cli

Command-line interface for [Rehydra](https://github.com/rehydra-ai/rehydra-sdk) PII anonymization.

## Install

```bash
npm install -g @rehydra/cli
```

## Usage

```bash
# Anonymize text
echo "Contact john@example.com" | rehydra anonymize

# Anonymize a file
rehydra anonymize input.txt -o output.txt

# Rehydrate (restore original PII)
rehydra rehydrate output.txt

# Inspect (dry-run, shows detected PII)
rehydra inspect input.txt

# Enable NER (detects names, orgs, locations)
rehydra anonymize input.txt --ner quantized

# JSON output
rehydra anonymize input.txt -f json

# Full help
rehydra --help
```

See the [main repo](https://github.com/rehydra-ai/rehydra-sdk) for full documentation.
