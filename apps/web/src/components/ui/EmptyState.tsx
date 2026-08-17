import { Icon, type IconName } from './Icon.js';
import { Button } from './Button.js';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 p-[var(--sp-6)] text-left">
      <Icon name={icon} size={28} className="text-ink-3" />
      <div className="flex flex-col gap-1">
        <p className="font-[var(--font-display)] text-[length:var(--fs-lg)] font-semibold text-ink">
          {title}
        </p>
        {body && <p className="text-[length:var(--fs-sm)] text-ink-2">{body}</p>}
      </div>
      {action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
