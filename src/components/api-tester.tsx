"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type HelloResponse = {
  message: string;
  timestamp: string;
  runtime: string;
  route: string;
};

export default function ApiTester() {
  const [result, setResult] = useState<HelloResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callApi() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hello", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Serverless function test</CardTitle>
        <CardDescription>
          Calls <code>GET /api/hello</code>, which runs as a serverless
          function on Vercel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={callApi} disabled={loading}>
          {loading ? "Calling…" : "Call serverless function"}
        </Button>
        {error && <p className="text-sm text-destructive">Error: {error}</p>}
        {result && (
          <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
