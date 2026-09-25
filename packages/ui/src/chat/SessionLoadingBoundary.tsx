import type { ReactNode } from "react";

/** Loading is presentation only: the mounted conversation owns pending sends. */
export function SessionLoadingBoundary({ loading, fallback, children }: {
  loading: boolean;
  fallback: ReactNode;
  children: ReactNode;
}) {
  return <>
    {loading ? fallback : null}
    <div hidden={loading} className={loading ? "hidden" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
      {children}
    </div>
  </>;
}
