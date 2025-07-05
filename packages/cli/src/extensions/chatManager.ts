/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID, createHash } from 'crypto';
import { homedir } from 'os';
import { Content } from '@google/genai';
import { ChatNamingService } from './chatNamingService.js';
import { Config } from '@google/gemini-cli-core';

export interface ChatInfo {
  id: string;
  name: string;
  created: number;
  lastUsed: number;
  directory: string;
  messageCount: number;
  workspaceHash: string;
  summary?: string; // Auto-generated summary for naming
}

export interface ChatConfig {
  enabled: boolean;
  autoLoad: boolean;
  maxChats: number;
  autoNaming: boolean;
  namingModel: string;
  currentChatId?: string;
}

export class ChatManager {
  private config: ChatConfig;
  public configPath: string;
  private chatsDir: string;
  private workspaceDir: string;
  private workspaceHash: string;
  private currentChat: ChatInfo | null = null;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.workspaceHash = this.generateWorkspaceHash(this.workspaceDir);
    this.configPath = this.findConfigPath();
    this.chatsDir = this.findChatsDir();
    this.config = this.loadConfig();
    this.ensureChatsDir();

    // Load current chat if specified in config
    if (this.config.currentChatId) {
      const chats = this.getAllChats();
      this.currentChat = chats.find(c => c.id === this.config.currentChatId) || null;
    }
  }

  private findConfigPath(): string {
    // Chat configuration is always stored in user home directory
    return path.join(homedir(), '.gemini', 'chat-config.json');
  }

  private findChatsDir(): string {
    // Chats are always stored in user home directory for centralized management
    return path.join(homedir(), '.gemini', 'chats');
  }

  private generateWorkspaceHash(workspaceDir: string): string {
    // Generate a short hash of the workspace directory for filtering
    return createHash('md5').update(workspaceDir).digest('hex').substring(0, 8);
  }

  private loadConfig(): ChatConfig {
    const defaultConfig: ChatConfig = {
      enabled: true, // Enable by default
      autoLoad: true,
      maxChats: 50,
      autoNaming: true,
      namingModel: 'gemini-2.5-flash',
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(configData) as Partial<ChatConfig>;
        return { ...defaultConfig, ...loadedConfig };
      }
    } catch (error) {
      console.warn('Failed to load chat config:', error);
    }

    return defaultConfig;
  }

  private saveConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save chat config:', error);
    }
  }

  private ensureChatsDir(): void {
    try {
      if (!fs.existsSync(this.chatsDir)) {
        fs.mkdirSync(this.chatsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create chats directory:', error);
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  private isChatForCurrentWorkspace(chat: ChatInfo): boolean {
    // Filter by workspace hash for better performance
    if (chat.workspaceHash && chat.workspaceHash === this.workspaceHash) {
      return true;
    }
    
    // Fallback to directory comparison for backward compatibility
    return chat.directory === this.workspaceDir;
  }

  public getLastChat(): ChatInfo | null {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const chats = this.getAllChats();
      if (chats.length === 0) {
        return null;
      }

      // Return the most recently used chat
      return chats.sort((a, b) => b.lastUsed - a.lastUsed)[0];
    } catch (error) {
      console.warn('Failed to get last chat:', error);
      return null;
    }
  }

  public getAllChats(): ChatInfo[] {
    if (!fs.existsSync(this.chatsDir)) {
      return [];
    }

    const chats: ChatInfo[] = [];

    try {
      const chatFiles = fs.readdirSync(this.chatsDir)
        .filter(file => file.endsWith('.json') && file.startsWith('chat-'));

      for (const file of chatFiles) {
        try {
          const chatPath = path.join(this.chatsDir, file);
          const chatData = fs.readFileSync(chatPath, 'utf8');
          const chat = JSON.parse(chatData) as ChatInfo;

          // Filter chats by workspace hash or directory
          if (this.isChatForCurrentWorkspace(chat)) {
            chats.push(chat);
          }
        } catch (error) {
          console.warn(`Failed to load chat ${file}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to read chats directory:', error);
    }

    return chats.sort((a, b) => b.lastUsed - a.lastUsed);
  }

  public createChat(name?: string): ChatInfo {
    const chatId = randomUUID();
    const now = Date.now();

    const chat: ChatInfo = {
      id: chatId,
      name: name || `Chat ${new Date().toLocaleString()}`,
      created: now,
      lastUsed: now,
      directory: this.workspaceDir,
      messageCount: 0,
      workspaceHash: this.workspaceHash,
    };

    this.saveChat(chat);
    this.currentChat = chat;

    // Update config to track current chat
    this.config.currentChatId = chatId;
    this.saveConfig();

    console.log(`Created new chat: ${chat.name}`);
    return chat;
  }

  public switchToChat(chatId: string): ChatInfo | null {
    const chats = this.getAllChats();
    const chat = chats.find(c => c.id === chatId);

    if (!chat) {
      console.error(`Chat ${chatId} not found`);
      return null;
    }

    chat.lastUsed = Date.now();
    this.saveChat(chat);
    this.currentChat = chat;

    // Update config to track current chat
    this.config.currentChatId = chatId;
    this.saveConfig();

    console.log(`Switched to chat: ${chat.name}`);
    return chat;
  }

  public getCurrentChat(): ChatInfo | null {
    return this.currentChat;
  }

  public updateCurrentChat(messageCount: number): void {
    if (!this.currentChat) {
      return;
    }

    this.currentChat.lastUsed = Date.now();
    this.currentChat.messageCount = messageCount;
    this.saveChat(this.currentChat);
  }

  private saveChat(chat: ChatInfo): void {
    try {
      const chatPath = path.join(this.chatsDir, `chat-${chat.id}.json`);
      fs.writeFileSync(chatPath, JSON.stringify(chat, null, 2));
    } catch (error) {
      console.error('Failed to save chat:', error);
    }
  }

  private getChatHistoryPath(chatId: string): string {
    return path.join(this.chatsDir, `history-${chatId}.json`);
  }

  // Save conversation history for the current chat
  public async saveChatHistory(history: Content[]): Promise<void> {
    if (!this.currentChat) {
      console.warn('No current chat to save history');
      return;
    }

    try {
      const historyPath = this.getChatHistoryPath(this.currentChat.id);
      await fs.promises.writeFile(historyPath, JSON.stringify(history, null, 2));
      
      this.currentChat.messageCount = history.length;
      this.currentChat.lastUsed = Date.now();
      this.saveChat(this.currentChat);
      
      console.log(`Saved chat history for: ${this.currentChat.name} (${history.length} messages)`);
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  }

  // Load conversation history for the current chat
  public async loadChatHistory(): Promise<Content[]> {
    if (!this.currentChat) {
      console.warn('No current chat to load history');
      return [];
    }

    try {
      const historyPath = this.getChatHistoryPath(this.currentChat.id);
      
      if (!fs.existsSync(historyPath)) {
        return [];
      }

      const historyData = await fs.promises.readFile(historyPath, 'utf8');
      const history = JSON.parse(historyData) as Content[];
      
      console.log(`Loaded chat history for: ${this.currentChat.name} (${history.length} messages)`);
      return history;
    } catch (error) {
      console.error('Failed to load chat history:', error);
      return [];
    }
  }

  public deleteChat(chatId: string): boolean {
    try {
      const chatPath = path.join(this.chatsDir, `chat-${chatId}.json`);
      const historyPath = this.getChatHistoryPath(chatId);
      
      if (fs.existsSync(chatPath)) {
        fs.unlinkSync(chatPath);
      }
      
      if (fs.existsSync(historyPath)) {
        fs.unlinkSync(historyPath);
      }
      
      console.log(`Deleted chat ${chatId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
    return false;
  }

  public cleanupOldChats(): void {
    const chats = this.getAllChats();
    if (chats.length <= this.config.maxChats) {
      return;
    }

    // Keep only the most recent chats
    const chatsToDelete = chats.slice(this.config.maxChats);

    for (const chat of chatsToDelete) {
      this.deleteChat(chat.id);
    }

    console.log(`Cleaned up ${chatsToDelete.length} old chats`);
  }

  // Generate a chat name using Gemini 2.5 Flash based on conversation content
  public async generateChatName(history: Content[], config?: Config): Promise<string> {
    if (!this.config.autoNaming || history.length === 0) {
      return `Chat ${new Date().toLocaleString()}`;
    }

    try {
      if (config) {
        const namingService = new ChatNamingService(config);
        return await namingService.generateChatName(history, this.config.namingModel);
      }

      // Fallback: create a simple name based on content
      const userMessages = history
        .filter(content => content.role === 'user')
        .slice(0, 3)
        .map(content => content.parts?.map(part => part.text).join(' ') || '')
        .join(' ')
        .substring(0, 500);

      if (!userMessages.trim()) {
        return `Chat ${new Date().toLocaleString()}`;
      }

      const words = userMessages.split(' ').slice(0, 4);
      let name = words.join(' ');

      // Limit to 30 characters for better display
      if (name.length > 30) {
        name = name.substring(0, 27) + '...';
      }

      return name || `Chat ${new Date().toLocaleString()}`;
    } catch (error) {
      console.warn('Failed to generate chat name:', error);
      return `Chat ${new Date().toLocaleString()}`;
    }
  }

  // Auto-update chat name based on conversation content
  public async updateChatNameIfNeeded(history: Content[], config?: Config): Promise<void> {
    if (!this.currentChat || !this.config.autoNaming) {
      return;
    }

    // Only auto-name if the chat still has the default name pattern
    let isDefaultName = false;
    if (config) {
      const namingService = new ChatNamingService(config);
      isDefaultName = namingService.isDefaultName(this.currentChat.name);
    } else {
      // Fallback check
      isDefaultName = this.currentChat.name.startsWith('Chat ') &&
                     this.currentChat.name.includes(':');
    }

    if (isDefaultName && history.length >= 2) { // At least one exchange
      try {
        const newName = await this.generateChatName(history, config);
        if (newName !== this.currentChat.name) {
          this.currentChat.name = newName;
          this.saveChat(this.currentChat);
          console.log(`Auto-updated chat name to: ${newName}`);
        }
      } catch (error) {
        console.warn('Failed to auto-update chat name:', error);
      }
    }
  }

  public getChatsCommand(): string {
    const chats = this.getAllChats();

    if (chats.length === 0) {
      return 'No chats found.';
    }

    let output = 'Available chats:\n';
    chats.forEach((chat, index) => {
      const current = this.currentChat?.id === chat.id ? ' (current)' : '';
      const lastUsed = new Date(chat.lastUsed).toLocaleString();
      const messageInfo = chat.messageCount > 0 ? ` (${chat.messageCount} messages)` : '';
      output += `${index + 1}. ${chat.name}${current}${messageInfo} - Last used: ${lastUsed}\n`;
    });

    output += '\nUse /chats switch <number> to switch to a chat';
    return output;
  }

  // Helper method to create initial config
  public static createInitialConfig(configPath: string): void {
    const initialConfig: ChatConfig = {
      enabled: true,
      autoLoad: true,
      maxChats: 50,
      autoNaming: true,
      namingModel: 'gemini-2.5-flash',
    };

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));
    console.log(`Created initial chat config at: ${configPath}`);
  }
}
