/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { vi } from 'vitest';
import { validateAuthMethod, parseAndValidateApiKeys } from './auth.js';

vi.mock('./settings.js', () => ({
  loadEnvironment: vi.fn(),
}));

vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    initializeApiKeyManager: vi.fn(() => ({
      getTotalKeyCount: () => 3,
      getActiveKeyCount: () => 3,
    })),
  };
});

describe('validateAuthMethod', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null for LOGIN_WITH_GOOGLE', () => {
    expect(validateAuthMethod(AuthType.LOGIN_WITH_GOOGLE)).toBeNull();
  });

  it('should return null for CLOUD_SHELL', () => {
    expect(validateAuthMethod(AuthType.CLOUD_SHELL)).toBeNull();
  });

  describe('USE_GEMINI', () => {
    it('should return null if GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      expect(validateAuthMethod(AuthType.USE_GEMINI)).toBeNull();
    });

    it('should return an error message if GEMINI_API_KEY is not set', () => {
      expect(validateAuthMethod(AuthType.USE_GEMINI)).toBe(
        'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!',
      );
    });
  });

  describe('USE_VERTEX_AI', () => {
    it('should return null if GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are set', () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      process.env.GOOGLE_CLOUD_LOCATION = 'test-location';
      expect(validateAuthMethod(AuthType.USE_VERTEX_AI)).toBeNull();
    });

    it('should return null if GOOGLE_API_KEY is set', () => {
      process.env.GOOGLE_API_KEY = 'test-api-key';
      expect(validateAuthMethod(AuthType.USE_VERTEX_AI)).toBeNull();
    });

    it('should return an error message if no required environment variables are set', () => {
      expect(validateAuthMethod(AuthType.USE_VERTEX_AI)).toBe(
        'When using Vertex AI, you must specify either:\n' +
          '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
          '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
          'Update your environment and try again (no reload needed if using .env)!',
      );
    });
  });

  it('should return an error message for an invalid auth method', () => {
    expect(validateAuthMethod('invalid-method')).toBe(
      'Invalid auth method selected.',
    );
  });
});

describe('parseAndValidateApiKeys', () => {
  it('should validate single API key', () => {
    const result = parseAndValidateApiKeys('AIzaSyTest123456789');
    expect(result.isValid).toBe(true);
    expect(result.keyCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('should validate multiple API keys', () => {
    const result = parseAndValidateApiKeys('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789');
    expect(result.isValid).toBe(true);
    expect(result.keyCount).toBe(3);
    expect(result.error).toBeUndefined();
  });

  it('should handle empty input', () => {
    const result = parseAndValidateApiKeys('');
    expect(result.isValid).toBe(false);
    expect(result.keyCount).toBe(0);
    expect(result.error).toBe('No API keys provided');
  });

  it('should handle whitespace-only input', () => {
    const result = parseAndValidateApiKeys('   ');
    expect(result.isValid).toBe(false);
    expect(result.keyCount).toBe(0);
    expect(result.error).toBe('No API keys provided');
  });

  it('should handle empty keys after parsing', () => {
    const result = parseAndValidateApiKeys(';;');
    expect(result.isValid).toBe(false);
    expect(result.keyCount).toBe(0);
    expect(result.error).toBe('No valid API keys found after parsing');
  });

  it('should detect invalid API keys', () => {
    const result = parseAndValidateApiKeys('short;AIzaSyTest123');
    expect(result.isValid).toBe(false);
    expect(result.keyCount).toBe(2);
    expect(result.error).toContain('1 API key(s) appear to be invalid');
  });

  it('should detect multiple invalid API keys', () => {
    const result = parseAndValidateApiKeys('short1;short2;AIzaSyTest123');
    expect(result.isValid).toBe(false);
    expect(result.keyCount).toBe(3);
    expect(result.error).toContain('2 API key(s) appear to be invalid');
  });
});

describe('validateAuthMethod with multiple API keys', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate single GEMINI_API_KEY', () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTest123456789';
    expect(validateAuthMethod(AuthType.USE_GEMINI)).toBeNull();
  });

  it('should validate multiple GEMINI_API_KEYs', () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTest123;AIzaSyTest456;AIzaSyTest789';
    expect(validateAuthMethod(AuthType.USE_GEMINI)).toBeNull();
  });

  it('should reject invalid API key format', () => {
    process.env.GEMINI_API_KEY = 'short';
    const result = validateAuthMethod(AuthType.USE_GEMINI);
    expect(result).toContain('Invalid GEMINI_API_KEY format');
  });

  it('should reject mixed valid and invalid keys', () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTest123;short';
    const result = validateAuthMethod(AuthType.USE_GEMINI);
    expect(result).toContain('Invalid GEMINI_API_KEY format');
  });
});
