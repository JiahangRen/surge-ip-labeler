export function resolveKeychainAccount({ explicitAccount, environment = process.env }) {
  return String(explicitAccount || environment.USER || environment.LOGNAME || '').trim();
}
