"use client";

import { HoleBackground } from "@/components/animate-ui/components/backgrounds/hole";
import {
  BlueTitle,
  GrayTitle,
  SectionHeading,
  SectionLabel1,
} from "@/components/reusables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PricingTable, SignInButton, useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { FEATURES, PLACEHOLDERS, STEPS, SUGGESTIONS } from "@/lib/data";
import { ArrowRight, ChevronRight } from "lucide-react";

export default function Home() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (isFocused || prompt) return;
    const t = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => clearInterval(t);
  }, [isFocused, prompt]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [prompt]);

  const handleSubmit = () => {
    if (!prompt.trim() || !isSignedIn) return;
    router.push(`/workspace?prompt=${encodeURIComponent(prompt)}`);
  };

  // submit on Enter, allow shift+Enter for new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSuggestions = (s: string) => {
    setPrompt(s);
    textareaRef.current?.focus();
  };

  return (
    <main className="min-h-screen bg-[#1a1815] selection:bg-white/20">
      <section className="relative flex flex-col items-center overflow-hidden px-4 pb-24 pt-40 text-center">
        <HoleBackground
          strokeColor="rgba(255,255,255,0.05)"
          className="absolute inset-0 h-full w-full"
          style={{
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
          }}
        />
        <Badge variant={"outline"} className="gap-2 backdrop-blur-sm">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Powered by Gemini 3.5
        </Badge>

        <h1 className="mx-auto max-w-3xl text-balance font-serif text-5xl leading-tight tracking-tight sm:text-5xl lg:text-7xl z-10">
          <GrayTitle>The Spark of Creation,</GrayTitle>
          <br />
          <BlueTitle>One Prompt Away.</BlueTitle>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-white/40 z-10">
          Describe your vision. Hephaestus forges the code, selects the
          packages, and renders a live preview, all inside your browser.
        </p>

        {/* Prompt Box */}
        <div className="relative mx-auto mt-12 w-full max-w-2xl ">
          <div
            className={cn(
              "rounded-2xl border bg-[#221f1b] duraction-200",
              isFocused
                ? "border-white/20 ring-1 ring-white/8"
                : "border-white/8",
            )}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              className="w-full resize-none bg-transparent px-5 pb-4 pt-5 text-sm placeholder:text-white/20 focus:outline-none sm:text-base"
              style={{ minHeight: 56, maxHeight: 200 }}
              placeholder={PLACEHOLDERS[placeholderIndex]}
            />
            <div className="flex items-center justify-between border-t border-white/6 px-4 py-2.5">
              <span className="text-xs text-white/20">
                Press ⏎ to generate · Shift + ⏎ for new line
              </span>

              {isSignedIn ? (
                <Button
                  onClick={handleSubmit}
                  disabled={!prompt.trim()}
                  className="h-8 rounded-full px-5 font-semibold"
                  variant={prompt.trim() ? "default" : "secondary"}
                >
                  Generate
                </Button>
              ) : (
                <SignInButton mode="modal">
                  <Button className="h-8 rounded-full bg-white px-5 font-semibold">
                    Generate
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </SignInButton>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestions(s)}
                className="rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-xs text-white/40 hover:border-white/15 hover:bg-white/8 hover:text-white/70"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-10 text-xs text-white/20">
          No credit card required · 10 free generations on sign up
        </p>
      </section>

      {/*This section is AI generated*/}
      <section className="px-4 pb-24">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-[#221f1b] shadow-2xl">
          {/* browser chrome */}
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#1d1b18] px-4 py-3">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
            </div>
            <div className="ml-3 flex-1 rounded-md bg-white/5 px-3 py-1 text-xs text-white/30">
              hephaestus.app/workspace/kanban-app
            </div>
          </div>

          {/* split panel */}
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] md:min-h-96">
            {/* chat panel */}
            <div className="flex flex-col border-b border-white/10 bg-[#1a1815] md:border-b-0 md:border-r">
              <div className="flex-1 space-y-3 p-4">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-white/10 px-3 py-2 text-xs text-white/80">
                  Build me a kanban board with drag and drop
                </div>
                <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2 text-xs text-white/60">
                  Sure! Scaffolding a kanban board with three columns and
                  draggable cards...
                </div>
                <div className="mr-auto flex max-w-[85%] items-center gap-1 rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40 [animation-delay:300ms]" />
                </div>
              </div>
              <div className="border-t border-white/10 p-3">
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/20">
                  Message Hephaestus...
                </div>
              </div>
            </div>

            {/* code/preview panel */}
            <div className="bg-[#1c1a17]">
              <div className="flex gap-4 border-b border-white/10 px-4 text-xs">
                <span className="border-b-2 border-white/60 py-2.5 text-white/70">
                  Preview
                </span>
                <span className="py-2.5 text-white/30">Code</span>
              </div>
              <div className="grid grid-cols-3 gap-3 p-4">
                {["Todo", "In Progress", "Done"].map((col) => (
                  <div key={col} className="rounded-lg bg-white/5 p-2">
                    <p className="mb-2 px-1 text-[11px] font-medium text-white/40">
                      {col}
                    </p>
                    <div className="space-y-2">
                      <div className="h-12 rounded-md border border-white/5 bg-white/5" />
                      <div className="h-12 rounded-md border border-white/5 bg-white/5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel1>Everything You Need</SectionLabel1>
          <SectionHeading gray="From Prompt" blue="To Production." />
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/6 bg-white/6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, label, desc }) => {
            return (
              <div
                key={label}
                className="group bg-[#1a1815] p-7 hover:bg-[#201e1a]"
              >
                <div
                  className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/4 group-hover:border-white/15
              group-hover:bg-white/8"
                >
                  <Icon className="h-4 w-4 text-white/60 group-hover:text-[#DD8967]/70" />
                </div>
                <p className="mb-2 text-sm font-semibold">{label}</p>
                <p className="text-sm leading-relaxed text-white/40">{desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel1>How It Works</SectionLabel1>
          <SectionHeading gray="Four Steps" blue="To A Working App." />
        </div>

        <div className="mx-auto max-w-3xl">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/4">
                  <span className="font-mono text-xs font-semibold text-white/50">
                    {step.number}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mt-2 h-full w-px bg-white/6" />
                )}
              </div>

              <div className="pb-10 pt-1.5">
                <p className="mb-1.5 text-sm font-semibold sm:text-base">
                  {step.label}
                </p>

                <p className="text-sm leading-relaxed text-white/40">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel1>Simple Pricing</SectionLabel1>
          <SectionHeading gray="Start Free" blue="Scale When Ready" />

          <p className="mx-auto mt-4 max-w-sm text-sm text-white/35">
            No Credit Card Required. Upgrade Or Downgrade Anytime
          </p>
        </div>

        <div className="mx-auto max-w-5xl">
          <PricingTable
            checkoutProps={{
              appearance: {
                elements: {
                  drawerRoot: {
                    zIndex: 2000,
                  },
                },
              },
            }}
          />
        </div>
      </section>

      <section className="relative mx-auto mb-32 max-w-5xl overflow-hidden rounded-2xl border border-white/8 px-10 py-24 text-center">
        <HoleBackground
          strokeColor="rgba(255,255,255,0.05)"
          className="absolute inset-0 h-full w-full"
          style={{
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
          }}
        />

        <SectionHeading gray="Start Building," blue="For Free." />

        <p className="mb-8 text-sm leading-relaxed text-white/40">
          Get 10 Free Generation On Sign Up. No Credit Card Required.
          <br />
          Upgrade When You&apos;re Ready.
        </p>

        <SignInButton mode="modal">
          <Button
            size="lg"
            className="relative h-11 rounded-full bg-white px-8"
          >
            Get Started For Free
            <ChevronRight className="h-4 w-4" />
          </Button>
        </SignInButton>
      </section>

      <footer className="relative z-10 border-t border-white/7 py-12 mx-auto px-6 flex flex-wrap items-center justify-center text-stone-400">
        Made With ❤️ By Aditya Kumar
      </footer>
    </main>
  );
}
