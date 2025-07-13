/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API Key Manager for handling multiple API keys with rotation and error handling
 */

export interface ApiKeyInfo {
  key: string;
  index: number;
  isActive: boolean;
  errorCount: number;
  lastUsed?: Date;
  lastError?: string;
}

export interface ApiKeyManagerConfig {
  rotationStrategy: 'round-robin' | 'least-errors' | 'random';
  maxErrorsPerKey: number;
  cooldownPeriod: number; // milliseconds
}

export class ApiKeyManager {
  private apiKeys: ApiKeyInfo[] = [];
  private currentIndex: number = 0;
  private config: ApiKeyManagerConfig;

  constructor(
    apiKeysString: string,
    config: Partial<ApiKeyManagerConfig> = {}
  ) {
    this.config = {
      rotationStrategy: 'round-robin',
      maxErrorsPerKey: 3,
      cooldownPeriod: 60000, // 1 minute
      ...config,
    };

    this.parseApiKeys(apiKeysString);
  }

  /**
   * Parse semicolon-separated API keys from environment variable
   */
  private parseApiKeys(apiKeysString: string): void {
    if (!apiKeysString || apiKeysString.trim() === '') {
      throw new Error('No API keys provided');
    }

    const keys = apiKeysString
      .split(';')
      .map(key => key.trim())
      .filter(key => key.length > 0);

    if (keys.length === 0) {
      throw new Error('No valid API keys found after parsing');
    }

    this.apiKeys = keys.map((key, index) => ({
      key,
      index,
      isActive: true,
      errorCount: 0,
    }));
  }

  /**
   * Get the current active API key
   */
  getCurrentApiKey(): string {
    const activeKeys = this.getActiveKeys();
    if (activeKeys.length === 0) {
      throw new Error('No active API keys available');
    }

    const currentKey = activeKeys.find(k => k.index === this.currentIndex) || activeKeys[0];
    currentKey.lastUsed = new Date();
    return currentKey.key;
  }

  /**
   * Get current API key info for display purposes
   */
  getCurrentApiKeyInfo(): ApiKeyInfo {
    const activeKeys = this.getActiveKeys();
    if (activeKeys.length === 0) {
      throw new Error('No active API keys available');
    }

    return activeKeys.find(k => k.index === this.currentIndex) || activeKeys[0];
  }

  /**
   * Rotate to the next API key based on the configured strategy
   */
  rotateApiKey(): string {
    const activeKeys = this.getActiveKeys();
    if (activeKeys.length === 0) {
      throw new Error('No active API keys available for rotation');
    }

    switch (this.config.rotationStrategy) {
      case 'round-robin':
        this.rotateRoundRobin(activeKeys);
        break;
      case 'least-errors':
        this.rotateLeastErrors(activeKeys);
        break;
      case 'random':
        this.rotateRandom(activeKeys);
        break;
    }

    return this.getCurrentApiKey();
  }

  /**
   * Report an error for the current API key
   */
  reportError(error: string): void {
    const currentKey = this.apiKeys.find(k => k.index === this.currentIndex);
    if (currentKey) {
      currentKey.errorCount++;
      currentKey.lastError = error;

      // Deactivate key if it has too many errors
      if (currentKey.errorCount >= this.config.maxErrorsPerKey) {
        currentKey.isActive = false;
        console.warn(`API key ${this.maskApiKey(currentKey.key)} deactivated due to ${currentKey.errorCount} errors`);
      }
    }
  }

  /**
   * Get all API keys status for display
   */
  getAllApiKeysStatus(): ApiKeyInfo[] {
    return this.apiKeys.map(key => ({ ...key }));
  }

  /**
   * Get count of active API keys
   */
  getActiveKeyCount(): number {
    return this.getActiveKeys().length;
  }

  /**
   * Get total count of API keys
   */
  getTotalKeyCount(): number {
    return this.apiKeys.length;
  }

  /**
   * Reset error counts for all keys (useful for recovery)
   */
  resetErrorCounts(): void {
    this.apiKeys.forEach(key => {
      key.errorCount = 0;
      key.isActive = true;
      key.lastError = undefined;
    });
  }

  /**
   * Mask API key for safe display (show first 8 and last 4 characters)
   */
  maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
      return '*'.repeat(apiKey.length);
    }
    return `${apiKey.substring(0, 8)}${'*'.repeat(apiKey.length - 12)}${apiKey.substring(apiKey.length - 4)}`;
  }

  private getActiveKeys(): ApiKeyInfo[] {
    return this.apiKeys.filter(key => key.isActive);
  }

  private rotateRoundRobin(activeKeys: ApiKeyInfo[]): void {
    const currentActiveIndex = activeKeys.findIndex(k => k.index === this.currentIndex);
    const nextActiveIndex = (currentActiveIndex + 1) % activeKeys.length;
    this.currentIndex = activeKeys[nextActiveIndex].index;
  }

  private rotateLeastErrors(activeKeys: ApiKeyInfo[]): void {
    const sortedKeys = [...activeKeys].sort((a, b) => a.errorCount - b.errorCount);
    this.currentIndex = sortedKeys[0].index;
  }

  private rotateRandom(activeKeys: ApiKeyInfo[]): void {
    const randomIndex = Math.floor(Math.random() * activeKeys.length);
    this.currentIndex = activeKeys[randomIndex].index;
  }
}

/**
 * Global API key manager instance
 */
let globalApiKeyManager: ApiKeyManager | null = null;

/**
 * Initialize the global API key manager
 */
export function initializeApiKeyManager(
  apiKeysString: string,
  config?: Partial<ApiKeyManagerConfig>
): ApiKeyManager {
  globalApiKeyManager = new ApiKeyManager(apiKeysString, config);
  return globalApiKeyManager;
}

/**
 * Get the global API key manager instance
 */
export function getApiKeyManager(): ApiKeyManager | null {
  return globalApiKeyManager;
}

/**
 * Check if multiple API keys are configured
 */
export function hasMultipleApiKeys(): boolean {
  return globalApiKeyManager ? globalApiKeyManager.getTotalKeyCount() > 1 : false;
}
