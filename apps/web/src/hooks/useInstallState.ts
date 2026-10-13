/**
 * What the install UI should offer on this device: nothing (already installed or the
 * browser can't), the browser's own prompt, or iOS's manual Add to Home Screen steps.
 */
import { useEffect, useState } from 'react';
import { INSTALL_STATE_EVENT, canPromptInstall, isIOS, isStandalone } from '../lib/install.js';

export type InstallState = 'installed' | 'prompt' | 'ios' | 'unavailable';

function current(): InstallState {
  if (isStandalone()) return 'installed';
  if (canPromptInstall()) return 'prompt';
  if (isIOS()) return 'ios';
  return 'unavailable';
}

export function useInstallState(): InstallState {
  const [state, setState] = useState<InstallState>(current);
  useEffect(() => {
    const update = () => setState(current());
    window.addEventListener(INSTALL_STATE_EVENT, update);
    return () => window.removeEventListener(INSTALL_STATE_EVENT, update);
  }, []);
  return state;
}
