/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';
import { getEffectiveModel } from './modelCheck.js';
import { UserTierId } from '../code_assist/types.js';
import { getApiKeyManager } from './apiKeyManager.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  getTier?(): Promise<UserTierId | undefined>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
): Promise<ContentGeneratorConfig> {
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = model || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    // Check if we have multiple API keys managed by the API key manager
    const apiKeyManager = getApiKeyManager();
    if (apiKeyManager) {
      // Use the current API key from the manager
      contentGeneratorConfig.apiKey = apiKeyManager.getCurrentApiKey();
    } else {
      // Single API key mode
      contentGeneratorConfig.apiKey = geminiApiKey;
    }

    contentGeneratorConfig.vertexai = false;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
    );

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

/**
 * Rotate to the next API key if multiple keys are available
 * @returns Information about the current API key after rotation
 */
export function rotateApiKey(): { rotated: boolean; currentKey?: string; keyInfo?: string } {
  const apiKeyManager = getApiKeyManager();
  if (!apiKeyManager || apiKeyManager.getTotalKeyCount() <= 1) {
    return { rotated: false };
  }

  try {
    const newKey = apiKeyManager.rotateApiKey();
    const keyInfo = apiKeyManager.getCurrentApiKeyInfo();

    // Trigger a content generator refresh by updating the global state
    // This will be picked up by the next API call
    globalApiKeyRotated = true;

    return {
      rotated: true,
      currentKey: newKey,
      keyInfo: `API ${keyInfo.index + 1}/${apiKeyManager.getTotalKeyCount()} (${apiKeyManager.maskApiKey(newKey)})`
    };
  } catch (error) {
    console.error('Failed to rotate API key:', error);
    return { rotated: false };
  }
}

// Global flag to track API key rotation
let globalApiKeyRotated = false;

/**
 * Check if API key has been rotated and reset the flag
 */
export function checkAndResetApiKeyRotation(): boolean {
  const rotated = globalApiKeyRotated;
  globalApiKeyRotated = false;
  return rotated;
}

/**
 * Report an error for the current API key
 */
export function reportApiKeyError(error: string): void {
  const apiKeyManager = getApiKeyManager();
  if (apiKeyManager) {
    apiKeyManager.reportError(error);
  }
}

/**
 * Get current API key information for display
 */
export function getCurrentApiKeyInfo(): string | null {
  const apiKeyManager = getApiKeyManager();
  if (!apiKeyManager) {
    return null;
  }

  try {
    const keyInfo = apiKeyManager.getCurrentApiKeyInfo();
    return `API ${keyInfo.index + 1}/${apiKeyManager.getTotalKeyCount()} (${apiKeyManager.maskApiKey(keyInfo.key)})`;
  } catch (error) {
    return null;
  }
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };
  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    return createCodeAssistContentGenerator(
      httpOptions,
      config.authType,
      gcConfig,
      sessionId,
    );
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    // Create a dynamic API key provider for multi-key support
    const apiKeyManager = getApiKeyManager();

    if (apiKeyManager && config.authType === AuthType.USE_GEMINI) {
      // For multi-key scenarios, create a proxy that dynamically gets the current API key
      const dynamicGoogleGenAI = createDynamicGoogleGenAI(httpOptions, config.vertexai, apiKeyManager);
      return dynamicGoogleGenAI.models;
    } else {
      // Single key or Vertex AI mode
      const googleGenAI = new GoogleGenAI({
        apiKey: config.apiKey === '' ? undefined : config.apiKey,
        vertexai: config.vertexai,
        httpOptions,
      });
      return googleGenAI.models;
    }
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}

/**
 * Create a dynamic content generator that uses the current API key from the manager
 */
function createDynamicGoogleGenAI(httpOptions: any, vertexai?: boolean, apiKeyManager?: any): any {
  // Return a models object that dynamically creates GoogleGenAI instances
  return {
    models: {
      generateContent: (params: any) => {
        const currentApiKey = apiKeyManager.getCurrentApiKey();
        const googleGenAI = new GoogleGenAI({
          apiKey: currentApiKey,
          vertexai,
          httpOptions,
        });
        return googleGenAI.models.generateContent(params);
      },

      generateContentStream: (params: any) => {
        const currentApiKey = apiKeyManager.getCurrentApiKey();
        const googleGenAI = new GoogleGenAI({
          apiKey: currentApiKey,
          vertexai,
          httpOptions,
        });
        return googleGenAI.models.generateContentStream(params);
      },

      countTokens: (params: any) => {
        const currentApiKey = apiKeyManager.getCurrentApiKey();
        const googleGenAI = new GoogleGenAI({
          apiKey: currentApiKey,
          vertexai,
          httpOptions,
        });
        return googleGenAI.models.countTokens(params);
      },

      embedContent: (params: any) => {
        const currentApiKey = apiKeyManager.getCurrentApiKey();
        const googleGenAI = new GoogleGenAI({
          apiKey: currentApiKey,
          vertexai,
          httpOptions,
        });
        return googleGenAI.models.embedContent(params);
      },

      batchEmbedContents: (params: any) => {
        const currentApiKey = apiKeyManager.getCurrentApiKey();
        const googleGenAI = new GoogleGenAI({
          apiKey: currentApiKey,
          vertexai,
          httpOptions,
        });
        return googleGenAI.models.embedContent(params);
      }
    }
  };
}
