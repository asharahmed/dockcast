export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({ width = '100%', height = '1rem', className = '' }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-[var(--r-1)] bg-surface-2 ${className}`}
      style={{ width, height }}
    />
  );
}
