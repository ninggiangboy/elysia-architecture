// Shared by the signed-in devices list and the default name of a new passkey.
import { i18n } from '@/i18n'

type Matchers = ReadonlyArray<readonly [RegExp, string]>

// Order matters: Edge and Chrome UAs also contain "Chrome/" and "Safari/".
const BROWSERS: Matchers = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: Matchers = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]
const detect = (matchers: Matchers, ua: string) => matchers.find(([re]) => re.test(ua))?.[1] ?? null

/** "Chrome on macOS" from a User-Agent; good enough for recognising a device, not for anything security-relevant. */
export function describeDevice(userAgent: string | null) {
  if (!userAgent) return i18n.t('device.unknown')
  const browser = detect(BROWSERS, userAgent)
  const os = detect(SYSTEMS, userAgent)
  if (browser && os) return i18n.t('device.on', { browser, os })
  return browser ?? os ?? userAgent.slice(0, 40)
}
