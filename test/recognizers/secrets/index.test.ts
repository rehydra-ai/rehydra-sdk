import { describe, it, expect } from "vitest";
import { createSecretRecognizers } from "../../../src/recognizers/secrets/index.js";
import { PIIType } from "../../../src/types/index.js";

describe("createSecretRecognizers", () => {
  it("should return all recognizers with defaults", () => {
    const recognizers = createSecretRecognizers();
    expect(recognizers.length).toBeGreaterThanOrEqual(7);
  });

  it("should pass minValueLength to env-var and config-secret recognizers", () => {
    // With default minValueLength (8), this short value IS detected
    const defaultRecognizers = createSecretRecognizers();
    const envVarDefault = defaultRecognizers.find(
      (r) => r.type === PIIType.ENV_VAR_SECRET,
    )!;
    const shortEnvText = "API_KEY=short123";
    expect(envVarDefault.find(shortEnvText)).toHaveLength(1);

    // With minValueLength=20, same short value is NOT detected
    const customRecognizers = createSecretRecognizers({ minValueLength: 20 });
    const envVarCustom = customRecognizers.find(
      (r) => r.type === PIIType.ENV_VAR_SECRET,
    )!;
    expect(envVarCustom.find(shortEnvText)).toHaveLength(0);

    const configSecretCustom = customRecognizers.find(
      (r) => r.type === PIIType.CONFIG_SECRET,
    )!;
    const shortConfigText = '"api_key": "short123"';
    expect(configSecretCustom.find(shortConfigText)).toHaveLength(0);
  });

  it("should pass secretKeyPatterns to env-var and config-secret recognizers", () => {
    const customRecognizers = createSecretRecognizers({
      secretKeyPatterns: [/^MY_APP_/i],
    });

    const envVar = customRecognizers.find(
      (r) => r.type === PIIType.ENV_VAR_SECRET,
    )!;
    // MY_APP_SETTING is not a default secret key name, but matches our custom pattern
    const envText = "MY_APP_SETTING=some-long-secret-value-here";
    expect(envVar.find(envText)).toHaveLength(1);

    const configSecret = customRecognizers.find(
      (r) => r.type === PIIType.CONFIG_SECRET,
    )!;
    const configText = '"my_app_setting": "some-long-secret-value-here"';
    expect(configSecret.find(configText)).toHaveLength(1);
  });

  it("should not match custom key patterns without the option", () => {
    const defaultRecognizers = createSecretRecognizers();

    const envVar = defaultRecognizers.find(
      (r) => r.type === PIIType.ENV_VAR_SECRET,
    )!;
    const envText = "MY_APP_SETTING=some-long-secret-value-here";
    expect(envVar.find(envText)).toHaveLength(0);
  });
});
