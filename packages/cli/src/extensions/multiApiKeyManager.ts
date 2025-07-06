/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface ApiKeyError {
  timestamp: number;
  message: string;
}

interface ApiKeyConfig {
  key: string;
  name?: string;
  weight?: number;
  enabled?: boolean;
  maxRequestsPerMinute?: number;
  lastUsed?: number;
  errorCount?: number; // Keep for backward compatibility
  errors?: ApiKeyError[]; // New time-based error tracking
}

export interface MultiApiKeyConfig {
  enabled: boolean;
  apiKeys: ApiKeyConfig[];
  strategy: 'round-robin' | 'random' | 'weighted' | 'least-used';
  retryAttempts: number;
  retryDelay: number;
  healthCheckEnabled: boolean;
  healthCheckInterval: number;
  currentIndex?: number; // Persistent round-robin index
}

export class MultiApiKeyManager {
  private config: MultiApiKeyConfig;
  private configPath: string;
  private currentIndex = 0;
  private lastHealthCheck = 0;

  // Time-based error tracking constants
  private static readonly ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_ERRORS_IN_WINDOW = 5; // Max errors in time window
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Clean up old errors every minute

  constructor(workspaceDir?: string) {
    this.configPath = this.findConfigPath(workspaceDir);
    this.config = this.loadConfig();
    // Load persistent currentIndex from config
    this.currentIndex = this.config.currentIndex || 0;
    // Clean up old errors on initialization
    this.cleanupOldErrors();
  }

  private findConfigPath(workspaceDir?: string): string {
    const configFileName = 'multi-api-config.json';
    
    // Try workspace .gemini directory first
    if (workspaceDir) {
      const workspaceConfig = path.join(workspaceDir, '.gemini', configFileName);
      if (fs.existsSync(workspaceConfig)) {
        return workspaceConfig;
      }
    }
    
    // Try current directory .gemini
    const currentDirConfig = path.join(process.cwd(), '.gemini', configFileName);
    if (fs.existsSync(currentDirConfig)) {
      return currentDirConfig;
    }
    
    // Fallback to user home directory
    return path.join(homedir(), '.gemini', configFileName);
  }

  private loadConfig(): MultiApiKeyConfig {
    const defaultConfig: MultiApiKeyConfig = {
      enabled: false,
      apiKeys: [],
      strategy: 'round-robin',
      retryAttempts: 3,
      retryDelay: 1000,
      healthCheckEnabled: true,
      healthCheckInterval: 300000, // 5 minutes
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(configData) as Partial<MultiApiKeyConfig>;
        return { ...defaultConfig, ...loadedConfig };
      }
    } catch (error) {
      console.warn(`Failed to load multi-API key config from ${this.configPath}:`, error);
    }

    return defaultConfig;
  }

  public saveConfig(): void {
    try {
      // Update persistent currentIndex in config
      this.config.currentIndex = this.currentIndex;

      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save multi-API key config:', error);
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled && this.config.apiKeys.length > 0;
  }

  public getCurrentApiKey(): string | null {
    if (!this.isEnabled()) {
      return null;
    }

    const availableKeys = this.getAvailableKeys();
    if (availableKeys.length === 0) {
      throw new Error('No available API keys');
    }

    let selectedKey: ApiKeyConfig;

    switch (this.config.strategy) {
      case 'random':
        selectedKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
        break;
      case 'weighted':
        selectedKey = this.selectWeighted(availableKeys);
        break;
      case 'least-used':
        selectedKey = this.selectLeastUsed(availableKeys);
        break;
      case 'round-robin':
      default:
        selectedKey = this.selectRoundRobin(availableKeys);
        break;
    }

    // Update usage stats in the original config
    const configKey = this.config.apiKeys.find(k => k.key === selectedKey.key);
    if (configKey) {
      configKey.lastUsed = Date.now();
      this.saveConfig();
    }

    const keyPreview = selectedKey.key.substring(0, 20) + '...';
    console.log(`🔑 Multi-API-Key: Using ${selectedKey.name || 'Unnamed'} (${keyPreview}) - Strategy: ${this.config.strategy}, Index: ${this.currentIndex}`);
    return selectedKey.key;
  }

  private getAvailableKeys(): ApiKeyConfig[] {
    // Clean up old errors before checking availability
    this.cleanupOldErrors();

    return this.config.apiKeys.filter(key => {
      if (key.enabled === false || !key.key) {
        return false;
      }

      // Check recent errors within time window
      const recentErrors = this.getRecentErrorCount(key);
      const isAvailable = recentErrors < MultiApiKeyManager.MAX_ERRORS_IN_WINDOW;

      if (!isAvailable) {
        console.log(`⏰ Multi-API-Key: ${key.name} temporarily unavailable (${recentErrors} errors in last ${MultiApiKeyManager.ERROR_WINDOW_MS / 60000} minutes)`);
      }

      return isAvailable;
    });
  }

  private selectWeighted(keys: ApiKeyConfig[]): ApiKeyConfig {
    const totalWeight = keys.reduce((sum, key) => sum + (key.weight || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const key of keys) {
      random -= (key.weight || 1);
      if (random <= 0) return key;
    }
    
    return keys[0];
  }

  private selectLeastUsed(keys: ApiKeyConfig[]): ApiKeyConfig {
    return keys.reduce((least, current) =>
      (current.lastUsed || 0) < (least.lastUsed || 0) ? current : least
    );
  }

  private selectRoundRobin(availableKeys: ApiKeyConfig[]): ApiKeyConfig {
    if (availableKeys.length === 0) {
      throw new Error('No available keys for round-robin selection');
    }

    // Use a simpler approach: maintain an index within the available keys array
    // This ensures perfect round-robin distribution among available keys

    // Get the current round-robin index for available keys
    let roundRobinIndex = this.currentIndex % availableKeys.length;

    // Select the key at the current round-robin position
    const selectedKey = availableKeys[roundRobinIndex];

    // Increment for next time (will wrap around automatically with modulo)
    this.currentIndex = (this.currentIndex + 1) % availableKeys.length;

    return selectedKey;
  }

  public reportError(apiKey: string, error: Error): void {
    const keyConfig = this.config.apiKeys.find(k => k.key === apiKey);
    if (keyConfig) {
      this.addError(keyConfig, error);
      this.saveConfig();
    }
  }

  public reportSuccess(apiKey: string): void {
    const keyConfig = this.config.apiKeys.find(k => k.key === apiKey);
    if (keyConfig) {
      keyConfig.errorCount = 0; // Reset error count on success
      this.saveConfig();
    }
  }

  public getStats() {
    const availableKeys = this.getAvailableKeys();
    return {
      enabled: this.config.enabled,
      strategy: this.config.strategy,
      totalKeys: this.config.apiKeys.length,
      availableKeys: availableKeys.length,
      currentIndex: this.currentIndex,
      errorWindowMinutes: MultiApiKeyManager.ERROR_WINDOW_MS / 60000,
      maxErrorsInWindow: MultiApiKeyManager.MAX_ERRORS_IN_WINDOW,
      keys: this.config.apiKeys.map(key => ({
        name: key.name || 'Unnamed',
        enabled: key.enabled !== false,
        lastUsed: key.lastUsed,
        errorCount: key.errorCount || 0,
        recentErrors: this.getRecentErrorCount(key),
        isAvailable: availableKeys.some(ak => ak.key === key.key),
      })),
    };
  }

  // Helper method to create initial config
  public static createInitialConfig(configPath: string): void {
    const initialConfig: MultiApiKeyConfig = {
      enabled: false,
      apiKeys: [
        {
          key: 'your-first-api-key-here',
          name: 'Account 1',
          weight: 1,
          enabled: true,
        },
        {
          key: 'your-second-api-key-here',
          name: 'Account 2',
          weight: 1,
          enabled: true,
        },
      ],
      strategy: 'round-robin',
      retryAttempts: 3,
      retryDelay: 1000,
      healthCheckEnabled: true,
      healthCheckInterval: 300000,
    };

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));
    console.log(`Created initial multi-API key config at: ${configPath}`);
    console.log('Please edit the config file to add your API keys and enable the feature.');
  }

  // Method to handle API key rotation on error
  public getNextApiKeyOnError(currentKey: string, error?: Error): string | null {
    if (!this.isEnabled()) {
      return null;
    }

    // Find current key info for logging
    const currentKeyInfo = this.config.apiKeys.find(k => k.key === currentKey);
    const currentKeyName = currentKeyInfo?.name || 'Unknown';
    const currentKeyPreview = currentKey.substring(0, 20) + '...';

    console.log(`❌ Multi-API-Key: Error with ${currentKeyName} (${currentKeyPreview}): ${error?.message || 'API request failed'}`);

    // Report the error for the current key
    this.reportError(currentKey, error || new Error('API request failed'));

    const availableKeys = this.getAvailableKeys().filter(k => k.key !== currentKey);
    if (availableKeys.length === 0) {
      console.log(`⚠️  Multi-API-Key: No more available keys to switch to`);
      return null;
    }

    // Select next key from available keys (excluding the current failed key)
    let selectedKey: ApiKeyConfig;

    switch (this.config.strategy) {
      case 'random':
        selectedKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
        break;
      case 'weighted':
        selectedKey = this.selectWeighted(availableKeys);
        break;
      case 'least-used':
        selectedKey = this.selectLeastUsed(availableKeys);
        break;
      case 'round-robin':
      default:
        // For round-robin, select the next available key in sequence
        selectedKey = this.selectRoundRobin(availableKeys);
        break;
    }

    // Update usage stats
    const configKey = this.config.apiKeys.find(k => k.key === selectedKey.key);
    if (configKey) {
      configKey.lastUsed = Date.now();
      this.saveConfig();
    }

    const nextKeyName = selectedKey.name || 'Unknown';
    const nextKeyPreview = selectedKey.key.substring(0, 20) + '...';
    console.log(`🔄 Multi-API-Key: Switching from ${currentKeyName} to ${nextKeyName} (${nextKeyPreview})`);

    return selectedKey.key;
  }

  /**
   * Clean up errors older than the time window
   */
  private cleanupOldErrors(): void {
    const now = Date.now();
    const cutoffTime = now - MultiApiKeyManager.ERROR_WINDOW_MS;
    let hasChanges = false;

    this.config.apiKeys.forEach(key => {
      if (key.errors && key.errors.length > 0) {
        const originalLength = key.errors.length;
        key.errors = key.errors.filter(error => error.timestamp > cutoffTime);
        if (key.errors.length !== originalLength) {
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.saveConfig();
      console.log(`🧹 Multi-API-Key: Cleaned up old errors (older than ${MultiApiKeyManager.ERROR_WINDOW_MS / 60000} minutes)`);
    }
  }

  /**
   * Get the number of errors for a key within the time window
   */
  private getRecentErrorCount(key: ApiKeyConfig): number {
    if (!key.errors) return 0;

    const now = Date.now();
    const cutoffTime = now - MultiApiKeyManager.ERROR_WINDOW_MS;

    return key.errors.filter(error => error.timestamp > cutoffTime).length;
  }

  /**
   * Add an error to a key's error history
   */
  private addError(key: ApiKeyConfig, error: Error): void {
    if (!key.errors) {
      key.errors = [];
    }

    key.errors.push({
      timestamp: Date.now(),
      message: error.message
    });

    // Keep backward compatibility with errorCount
    key.errorCount = (key.errorCount || 0) + 1;

    console.log(`📊 Multi-API-Key: Error reported for ${key.name}: ${error.message} (Recent errors: ${this.getRecentErrorCount(key)})`);
  }
}
