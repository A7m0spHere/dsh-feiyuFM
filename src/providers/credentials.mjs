import { createDpapiCredentials } from './credentials-dpapi.mjs';
import { createMacKeychainCredentials } from './credentials-macos.mjs';

export function createPlatformCredentials({ platform = process.platform, directory } = {}) {
  if (platform === 'win32') return createDpapiCredentials({ directory });
  if (platform === 'darwin') return createMacKeychainCredentials();
  throw new Error(`Secure FishFM credentials are not supported on ${platform}`);
}
