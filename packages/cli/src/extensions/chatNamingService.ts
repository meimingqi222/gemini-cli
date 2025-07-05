/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content } from '@google/genai';
import { Config } from '@google/gemini-cli-core';

export class ChatNamingService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Generate a chat name using Gemini 2.5 Flash based on conversation content
   */
  public async generateChatName(history: Content[], model: string = 'gemini-2.5-flash'): Promise<string> {
    if (history.length === 0) {
      return `Chat ${new Date().toLocaleString()}`;
    }

    try {
      // Extract first few user messages for context
      const userMessages = history
        .filter(content => content.role === 'user')
        .slice(0, 3) // Take first 3 user messages
        .map(content => content.parts?.map(part => part.text).join(' ') || '')
        .join(' ')
        .substring(0, 500); // Limit to 500 characters

      if (!userMessages.trim()) {
        return `Chat ${new Date().toLocaleString()}`;
      }

      // Create a prompt for generating a concise title
      const prompt = `Based on this conversation start, generate a concise, descriptive title (max 25 characters) that captures the main topic or intent. Only return the title, nothing else:

${userMessages}`;

      // Use the existing Gemini client but temporarily switch to Flash model for naming
      const originalModel = this.config.getModel();
      
      try {
        // Temporarily switch to Flash model for naming
        this.config.setModel(model);
        
        // Get a fresh chat instance for naming
        const geminiClient = this.config.getGeminiClient();
        const namingChat = geminiClient.getChat();
        
        const response = await namingChat.sendMessage({ message: prompt });
        const generatedName = response.text?.trim();
        
        if (generatedName && generatedName.length > 0 && generatedName.length <= 30) {
          // Clean up the generated name
          const cleanName = generatedName
            .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
            .replace(/\s+/g, ' ') // Normalize spaces
            .trim();
          
          if (cleanName.length > 0) {
            return cleanName;
          }
        }
      } finally {
        // Restore original model
        this.config.setModel(originalModel);
      }

      // Fallback: create a simple name based on content
      const words = userMessages.split(' ').slice(0, 4);
      let name = words.join(' ');
      
      // Limit to 30 characters for better display
      if (name.length > 30) {
        name = name.substring(0, 27) + '...';
      }
      
      return name || `Chat ${new Date().toLocaleString()}`;
    } catch (error) {
      console.warn('Failed to generate chat name using Gemini API:', error);
      
      // Fallback to simple naming
      try {
        const userMessages = history
          .filter(content => content.role === 'user')
          .slice(0, 1)
          .map(content => content.parts?.map(part => part.text).join(' ') || '')
          .join(' ')
          .substring(0, 25);

        if (userMessages.trim()) {
          return userMessages.trim() + (userMessages.length > 22 ? '...' : '');
        }
      } catch (fallbackError) {
        console.warn('Fallback naming also failed:', fallbackError);
      }
      
      return `Chat ${new Date().toLocaleString()}`;
    }
  }

  /**
   * Check if a name appears to be auto-generated (default pattern)
   */
  public isDefaultName(name: string): boolean {
    // Check for default patterns like "Chat 12/25/2024, 3:45:23 PM"
    return name.startsWith('Chat ') && 
           (name.includes(':') || name.includes('/') || name.includes('-'));
  }

  /**
   * Generate a summary of the conversation for display purposes
   */
  public generateConversationSummary(history: Content[]): string {
    if (history.length === 0) {
      return 'Empty conversation';
    }

    const userMessages = history
      .filter(content => content.role === 'user')
      .slice(0, 2)
      .map(content => content.parts?.map(part => part.text).join(' ') || '')
      .join(' ')
      .substring(0, 100);

    const modelMessages = history
      .filter(content => content.role === 'model')
      .slice(0, 1)
      .map(content => content.parts?.map(part => part.text).join(' ') || '')
      .join(' ')
      .substring(0, 100);

    let summary = '';
    if (userMessages.trim()) {
      summary += `User: ${userMessages.trim()}`;
      if (userMessages.length > 97) summary += '...';
    }
    
    if (modelMessages.trim()) {
      if (summary) summary += '\n';
      summary += `Assistant: ${modelMessages.trim()}`;
      if (modelMessages.length > 97) summary += '...';
    }

    return summary || 'Conversation in progress';
  }
}
