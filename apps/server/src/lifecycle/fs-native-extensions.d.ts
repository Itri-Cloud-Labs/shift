// Verified against fs-native-extensions 1.5.1. Only the API used by Shift is declared.
declare module 'fs-native-extensions' {
  export function tryLock(fd: number): boolean;
}
