import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SECRET_KEY_STORAGE_KEY = 'antigravity_companion_secret_key';
const DEVICE_ID_STORAGE_KEY = 'antigravity_companion_device_id';

export const CryptoService = {
  // Generates and securely stores a device ID and a 256-bit secure secret key
  initializeIdentity: async (): Promise<{ deviceId: string; secretKey: string }> => {
    let deviceId = await SecureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
    let secretKey = await SecureStore.getItemAsync(SECRET_KEY_STORAGE_KEY);

    if (!deviceId) {
      deviceId = Crypto.randomUUID();
      await SecureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, deviceId);
    }

    if (!secretKey) {
      // Generate 32 bytes of secure random entropy (256-bit key)
      const randomBytes = Crypto.getRandomBytes(32);
      // Convert to hex string
      secretKey = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await SecureStore.setItemAsync(SECRET_KEY_STORAGE_KEY, secretKey);
    }

    return { deviceId, secretKey };
  },

  // Clears stored identity keys (useful for unpairing)
  clearIdentity: async (): Promise<void> => {
    await SecureStore.deleteItemAsync(DEVICE_ID_STORAGE_KEY);
    await SecureStore.deleteItemAsync(SECRET_KEY_STORAGE_KEY);
  },

  // Gets the currently stored identity if it exists
  getIdentity: async (): Promise<{ deviceId: string; secretKey: string } | null> => {
    const deviceId = await SecureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
    const secretKey = await SecureStore.getItemAsync(SECRET_KEY_STORAGE_KEY);

    if (!deviceId || !secretKey) {
      return null;
    }

    return { deviceId, secretKey };
  },

  // Creates a secure SHA-256 signature for a request payload, timestamp, and nonce
  signRequest: async (
    payload: string,
    timestamp: string,
    nonce: string,
    secretKey: string
  ): Promise<string> => {
    // Concatenate components to create the signature input message
    const message = `${payload}|${timestamp}|${nonce}|${secretKey}`;
    
    // Hash using SHA-256
    const signature = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      message
    );
    
    return signature;
  },
};
