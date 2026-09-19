"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Root-level error boundary. Next.js only mounts this for an error the
// nearest route-level error.tsx didn't catch, so it reports genuinely
// unhandled app-crashing errors — exactly what task 10 needs visibility into.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
