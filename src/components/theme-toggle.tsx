"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "theme";

/** Runs before hydration (inlined in <head>) so the page never flashes. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage may be unavailable (private mode); the toggle still works.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
      title={dark ? "Jasny motyw" : "Ciemny motyw"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
