interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: "h-4 w-4 border-[1.5px]",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-2",
};

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <div
      className={`${sizes[size]} rounded-full border-stone-200 dark:border-stone-700 border-t-stone-500 dark:border-t-stone-400 animate-spin ${className}`}
    />
  );
}
