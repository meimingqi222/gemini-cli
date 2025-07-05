/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface ApiKeyConfig {
  key: string;
  name?: string;
  weight?: number;
  enabled?: boolean;
  maxRequestsPerMinute?: number;
  lastUsed?: number;
  errorCount?: number;
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

  constructor(workspaceDir?: string) {
    this.configPath = this.findConfigPath(workspaceDir);
    this.config = this.loadConfig();
    // Load persistent currentIndex from config
    this.currentIndex = this.config.currentIndex || 0;
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

    console.log(`Multi-API-Key: Using ${selectedKey.name || 'Unnamed'} (Strategy: ${this.config.strategy})`);
    return selectedKey.key;
  }

  private getAvailableKeys(): ApiKeyConfig[] {
    return this.config.apiKeys.filter(key => 
      key.enabled !== false && 
      key.key && 
      (key.errorCount || 0) < 5 // Disable keys with too many errors
    );
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
      keyConfig.errorCount = (keyConfig.errorCount || 0) + 1;
      console.warn(`Multi-API-Key: Error reported for ${keyConfig.name || 'Unnamed'}: ${error.message}`);
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
      keys: this.config.apiKeys.map(key => ({
        name: key.name || 'Unnamed',
        enabled: key.enabled !== false,
        lastUsed: key.lastUsed,
        errorCount: key.errorCount || 0,
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
  public getNextApiKeyOnError(currentKey: string): string | null {
    if (!this.isEnabled()) {
      return null;
    }

    this.reportError(currentKey, new Error('API request failed'));

    const availableKeys = this.getAvailableKeys().filter(k => k.key !== currentKey);
    if (availableKeys.length === 0) {
      return null;
    }

    // Get next key using the same strategy
    return this.getCurrentApiKey();
  }
}
