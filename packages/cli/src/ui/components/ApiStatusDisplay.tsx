/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { getCurrentApiKeyInfo, hasMultipleApiKeys, getApiKeyManager } from '@google/gemini-cli-core';
import { Colors } from '../colors.js';

interface ApiStatusDisplayProps {
  visible: boolean;
}

export const ApiStatusDisplay: React.FC<ApiStatusDisplayProps> = ({ visible }) => {
  if (!visible || !hasMultipleApiKeys()) {
    return null;
  }

  const apiKeyInfo = getCurrentApiKeyInfo();
  const apiKeyManager = getApiKeyManager();
  
  if (!apiKeyInfo || !apiKeyManager) {
    return null;
  }

  const activeCount = apiKeyManager.getActiveKeyCount();
  const totalCount = apiKeyManager.getTotalKeyCount();
  const allStatus = apiKeyManager.getAllApiKeysStatus();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={Colors.AccentBlue}>📡 API Status: </Text>
        <Text color={Colors.Foreground}>{apiKeyInfo}</Text>
        <Text color={Colors.Comment}> ({activeCount}/{totalCount} active)</Text>
      </Box>

      {/* Show detailed status if there are any inactive keys */}
      {activeCount < totalCount && (
        <Box marginTop={1}>
          <Text color={Colors.AccentYellow}>⚠️  Inactive keys: </Text>
          {allStatus
            .filter(key => !key.isActive)
            .map((key, index) => (
              <Text key={index} color={Colors.Comment}>
                API {key.index + 1} ({apiKeyManager.maskApiKey(key.key)}) - {key.errorCount} errors
              </Text>
            ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * Hook to get API status information
 */
export const useApiStatus = () => {
  const [apiInfo, setApiInfo] = React.useState<string | null>(null);
  const [hasMultiple, setHasMultiple] = React.useState(false);

  React.useEffect(() => {
    const updateApiStatus = () => {
      setHasMultiple(hasMultipleApiKeys());
      if (hasMultipleApiKeys()) {
        setApiInfo(getCurrentApiKeyInfo());
      } else {
        setApiInfo(null);
      }
    };

    updateApiStatus();
    
    // Update every 5 seconds to catch any changes
    const interval = setInterval(updateApiStatus, 5000);
    
    return () => clearInterval(interval);
  }, []);

  return { apiInfo, hasMultiple };
};
