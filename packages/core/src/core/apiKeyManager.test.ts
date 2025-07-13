/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyManager, initializeApiKeyManager, getApiKeyManager, hasMultipleApiKeys } from './apiKeyManager.js';

describe('ApiKeyManager', () => {
  describe('constructor and parsing', () => {
    it('should parse single API key', () => {
      const manager = new ApiKeyManager('AIzaSyTest123');
      expect(manager.getTotalKeyCount()).toBe(1);
      expect(manager.getActiveKeyCount()).toBe(1);
    });

    it('should parse multiple API keys separated by semicolons', () => {
      const manager = new ApiKeyManager('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789');
      expect(manager.getTotalKeyCount()).toBe(3);
      expect(manager.getActiveKeyCount()).toBe(3);
    });

    it('should handle whitespace around API keys', () => {
      const manager = new ApiKeyManager(' AIzaSyTest123 ; AIzaSyTest456 ; AIzaSyTest789 ');
      expect(manager.getTotalKeyCount()).toBe(3);
      expect(manager.getActiveKeyCount()).toBe(3);
    });

    it('should filter out empty keys', () => {
      const manager = new ApiKeyManager('AIzaSyTest123;;AIzaSyTest456;');
      expect(manager.getTotalKeyCount()).toBe(2);
      expect(manager.getActiveKeyCount()).toBe(2);
    });

    it('should throw error for empty input', () => {
      expect(() => new ApiKeyManager('')).toThrow('No API keys provided');
      expect(() => new ApiKeyManager('   ')).toThrow('No API keys provided');
    });

    it('should throw error for no valid keys after parsing', () => {
      expect(() => new ApiKeyManager(';;')).toThrow('No valid API keys found after parsing');
    });
  });

  describe('API key rotation', () => {
    let manager: ApiKeyManager;

    beforeEach(() => {
      manager = new ApiKeyManager('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789');
    });

    it('should return current API key', () => {
      const key = manager.getCurrentApiKey();
      expect(key).toBe('AIzaSyTest123');
    });

    it('should rotate to next key in round-robin fashion', () => {
      expect(manager.getCurrentApiKey()).toBe('AIzaSyTest123');
      
      const rotated1 = manager.rotateApiKey();
      expect(rotated1).toBe('AIzaSyTest456');
      
      const rotated2 = manager.rotateApiKey();
      expect(rotated2).toBe('AIzaSyTest789');
      
      const rotated3 = manager.rotateApiKey();
      expect(rotated3).toBe('AIzaSyTest123'); // Back to first
    });

    it('should handle least-errors rotation strategy', () => {
      const manager = new ApiKeyManager('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789', {
        rotationStrategy: 'least-errors'
      });

      // Add errors to first key
      manager.reportError('Test error 1');
      manager.reportError('Test error 2');
      
      // Rotate to next key
      manager.rotateApiKey();
      
      // Add error to second key
      manager.reportError('Test error 3');
      
      // Should rotate to third key (least errors)
      const rotated = manager.rotateApiKey();
      expect(rotated).toBe('AIzaSyTest789');
    });

    it('should handle random rotation strategy', () => {
      const manager = new ApiKeyManager('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789', {
        rotationStrategy: 'random'
      });

      const key = manager.rotateApiKey();
      expect(['AIzaSyTest123', 'AIzaSyTest456', 'AIzaSyTest789']).toContain(key);
    });
  });

  describe('error handling', () => {
    let manager: ApiKeyManager;

    beforeEach(() => {
      manager = new ApiKeyManager('AIzaSyTest123;AIzaSyTest456;AIzaSyTest789', {
        maxErrorsPerKey: 2
      });
    });

    it('should track errors for current key', () => {
      manager.reportError('Test error');
      
      const status = manager.getAllApiKeysStatus();
      expect(status[0].errorCount).toBe(1);
      expect(status[0].lastError).toBe('Test error');
      expect(status[0].isActive).toBe(true);
    });

    it('should deactivate key after max errors', () => {
      manager.reportError('Error 1');
      manager.reportError('Error 2');
      
      const status = manager.getAllApiKeysStatus();
      expect(status[0].errorCount).toBe(2);
      expect(status[0].isActive).toBe(false);
      expect(manager.getActiveKeyCount()).toBe(2);
    });

    it('should reset error counts', () => {
      manager.reportError('Error 1');
      manager.reportError('Error 2');
      
      expect(manager.getActiveKeyCount()).toBe(2);
      
      manager.resetErrorCounts();
      
      expect(manager.getActiveKeyCount()).toBe(3);
      const status = manager.getAllApiKeysStatus();
      status.forEach(key => {
        expect(key.errorCount).toBe(0);
        expect(key.isActive).toBe(true);
        expect(key.lastError).toBeUndefined();
      });
    });
  });

  describe('API key masking', () => {
    let manager: ApiKeyManager;

    beforeEach(() => {
      manager = new ApiKeyManager('AIzaSyTest123456789');
    });

    it('should mask API key for display', () => {
      const masked = manager.maskApiKey('AIzaSyTest123456789');
      expect(masked).toBe('AIzaSyTe*******6789');
    });

    it('should mask short keys completely', () => {
      const masked = manager.maskApiKey('short');
      expect(masked).toBe('*****');
    });
  });

  describe('global manager functions', () => {
    beforeEach(() => {
      // Reset global state
      initializeApiKeyManager('AIzaSyTest123');
    });

    it('should initialize global manager', () => {
      const manager = initializeApiKeyManager('AIzaSyTest123;AIzaSyTest456');
      expect(manager.getTotalKeyCount()).toBe(2);
      expect(getApiKeyManager()).toBe(manager);
    });

    it('should detect multiple API keys', () => {
      initializeApiKeyManager('AIzaSyTest123');
      expect(hasMultipleApiKeys()).toBe(false);
      
      initializeApiKeyManager('AIzaSyTest123;AIzaSyTest456');
      expect(hasMultipleApiKeys()).toBe(true);
    });
  });
});
