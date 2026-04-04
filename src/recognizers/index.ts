/**
 * Recognizers Module
 * Exports all recognizers and registry utilities
 */

export * from './base.js';
export * from './registry.js';
export { emailRecognizer } from './email.js';
export { phoneRecognizer } from './phone.js';
export { ibanRecognizer, getExpectedIBANLength } from './iban.js';
export { bicSwiftRecognizer } from './bic-swift.js';
export { creditCardRecognizer, identifyCardType } from './credit-card.js';
export { ipAddressRecognizer, isInternalIPv4 } from './ip-address.js';
export { urlRecognizer, extractDomain } from './url.js';
export { dateRecognizer } from './date.js';
export {
  createCustomIdRecognizer,
  createCaseIdRecognizer,
  createCustomerIdRecognizer,
  COMMON_ID_PATTERNS,
  isStructuredId,
} from './custom-id.js';

export { createSecretRecognizers } from './secrets/index.js';
export * from './secrets/index.js';

import { RecognizerRegistry } from './registry.js';
import { emailRecognizer } from './email.js';
import { phoneRecognizer } from './phone.js';
import { ibanRecognizer } from './iban.js';
import { bicSwiftRecognizer } from './bic-swift.js';
import { creditCardRecognizer } from './credit-card.js';
import { ipAddressRecognizer } from './ip-address.js';
import { urlRecognizer } from './url.js';
import { dateRecognizer } from './date.js';
import { createCaseIdRecognizer, createCustomerIdRecognizer } from './custom-id.js';

/**
 * Creates a registry with all default recognizers registered
 */
export function createDefaultRegistry(): RecognizerRegistry {
  const registry = new RecognizerRegistry();

  // Register all built-in recognizers
  registry.register(emailRecognizer);
  registry.register(phoneRecognizer);
  registry.register(ibanRecognizer);
  registry.register(bicSwiftRecognizer);
  registry.register(creditCardRecognizer);
  registry.register(ipAddressRecognizer);
  registry.register(urlRecognizer);
  registry.register(dateRecognizer);

  // Register default custom ID recognizers
  registry.register(createCaseIdRecognizer());
  registry.register(createCustomerIdRecognizer());

  return registry;
}

