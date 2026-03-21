/**
 * Private Key Recognizer
 * Detects PEM-encoded private keys
 */

import { createRegexRecognizer } from "../base.js";
import { PIIType } from "../../types/index.js";

export const privateKeyRecognizer = createRegexRecognizer({
  type: PIIType.PRIVATE_KEY,
  name: "Private Key",
  defaultConfidence: 0.99,
  patterns: [
    // Full PEM block (multiline)
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  ],
});
