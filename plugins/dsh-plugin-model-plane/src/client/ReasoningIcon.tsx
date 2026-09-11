/** Open thought orbits around a point of insight; drawn for a 14px seat. */
export function ReasoningIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
    >
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M14.8 3.8C11.7 2.2 6.3 5.1 3.9 9.3c-2.1 3.7-1.2 6.8 2 6.8 3.1 0 7.5-2.8 9.8-6.4" />
        <path d="M4.1 6.1c-1.3 2.3 1 6.4 5.1 9.1 3.7 2.4 7 2.2 7.5-.5.5-2.6-2.1-6.4-5.6-8.5" opacity=".65" />
      </g>
      <circle cx="10" cy="10" r="1.45" fill="currentColor" />
      <circle cx="16.6" cy="5.3" r="1.15" fill="currentColor" />
    </svg>
  );
}
