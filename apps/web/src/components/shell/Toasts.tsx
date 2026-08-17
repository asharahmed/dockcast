/**
 * Toast queue: bottom-centre, max 3, auto-dismiss 5 s. ui-spec.md §4.0.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon.js';

export type ToastTone = 'neutral' | 'good' | 'warn' | 'serious' | 'critical';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  addToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_RULE: Record<ToastTone, string> = {
  neutral: 'var(--rule-strong)',
  good: 'var(--st-good)',
  warn: 'var(--st-warn)',
  serious: 'var(--st-serious)',
  critical: 'var(--st-critical)',
};

const TONE_ICON: Record<ToastTone, IconName | null> = {
  neutral: null,
  good: 'check',
  warn: 'alert',
  serious: 'alert',
  critical: 'cross',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, tone }].slice(-3));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--sp-4)+56px)] z-30 flex flex-col items-center gap-2 md:bottom-[var(--sp-4)]">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center gap-2 rounded-[var(--r-1)] bg-surface px-4 py-3 text-[length:var(--fs-sm)] text-ink"
              style={{
                borderLeft: `3px solid ${TONE_RULE[toast.tone]}`,
                boxShadow: 'var(--shadow-panel)',
              }}
            >
              {TONE_ICON[toast.tone] && <Icon name={TONE_ICON[toast.tone]!} size={16} />}
              {toast.message}
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx.addToast;
}
