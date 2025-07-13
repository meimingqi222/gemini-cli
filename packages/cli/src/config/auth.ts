/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, initializeApiKeyManager } from '@google/gemini-cli-core';
import { loadEnvironment } from './settings.js';

/**
 * Parse and validate multiple API keys from environment variable
 */
export function parseAndValidateApiKeys(apiKeysString: string): { isValid: boolean; keyCount: number; error?: string } {
  if (!apiKeysString || apiKeysString.trim() === '') {
    return { isValid: false, keyCount: 0, error: 'No API keys provided' };
  }

  const keys = apiKeysString
    .split(';')
    .map(key => key.trim())
    .filter(key => key.length > 0);

  if (keys.length === 0) {
    return { isValid: false, keyCount: 0, error: 'No valid API keys found after parsing' };
  }

  // Basic validation - check if keys look like valid API keys (relaxed for testing)
  const invalidKeys = keys.filter(key => key.length < 8);
  if (invalidKeys.length > 0) {
    return {
      isValid: false,
      keyCount: keys.length,
      error: `${invalidKeys.length} API key(s) appear to be invalid (should be at least 8 characters)`
    };
  }

  return { isValid: true, keyCount: keys.length };
}

export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  if (
    authMethod === AuthType.LOGIN_WITH_GOOGLE ||
    authMethod === AuthType.CLOUD_SHELL
  ) {
    return null;
  }

  if (authMethod === AuthType.USE_GEMINI) {
    if (!process.env.GEMINI_API_KEY) {
      return 'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!';
    }

    // Validate and initialize API key manager for multiple keys
    const validation = parseAndValidateApiKeys(process.env.GEMINI_API_KEY);
    if (!validation.isValid) {
      return `Invalid GEMINI_API_KEY format: ${validation.error}`;
    }

    // Initialize the API key manager if we have multiple keys
    if (validation.keyCount > 1) {
      try {
        initializeApiKeyManager(process.env.GEMINI_API_KEY);
        console.log(`✓ Initialized with ${validation.keyCount} API keys for rotation`);
      } catch (error) {
        return `Failed to initialize API key manager: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    return null;
  }

  if (authMethod === AuthType.USE_VERTEX_AI) {
    const hasVertexProjectLocationConfig =
      !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    if (!hasVertexProjectLocationConfig && !hasGoogleApiKey) {
      return (
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  return 'Invalid auth method selected.';
};
