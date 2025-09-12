
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, BookOpen, ExternalLink, SplitIcon } from "lucide-react";
import { StudioConfig } from "@/microfox.config";

export default function Homepage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="container flex flex-col items-center justify-between min-h-screen mx-auto px-4 py-16 max-w-4xl">
        {/* Header */}
        <div className="text-center my-16">
          <h1 className=" text-5xl font-bold tracking-tight mb-6">
            {StudioConfig.appName}
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {StudioConfig.appDescription}
          </p>
        </div>

        {/* Main Content Card */}
        {/* <Card className="mb-12">
          <CardHeader>
            <CardTitle className="text-2xl">What is AI Router?</CardTitle>
            <CardDescription className="text-base">
              Powerful framework for building sophisticated AI systems
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              AI Router is a powerful framework that enables you to build sophisticated, 
              multi-agent AI systems with ease. Inspired by Express.js simplicity and 
              Google's Agent Development Kit approach, it provides a seamless integration 
              with Next.js and Vercel's AI SDK.
            </p>
            <p className="text-muted-foreground">
              Whether you're building conversational AI, research agents, or complex 
              orchestration systems, AI Router gives you the tools to create robust, 
              scalable AI applications.
            </p>
          </CardContent>
        </Card> */}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">

          <Button asChild size="lg">
            <Link href="/studio">
              <Zap className="w-4 h-4 mr-2" />
              Try in Chat Studio
            </Link>
          </Button>
        </div>


        <div className="mt-auto text-center flex flex-col gap-4 items-center justify-center mb-6">
          <div className="flex items-center gap-2">
            <p>Built with</p>
            <Badge variant="secondary" className="text-sm px-4 py-2">
              <SplitIcon className="w-4 h-4 mr-2" />
              Ai Router
            </Badge>
            <Button asChild size="sm" variant="ghost">
              <Link href="https://docs.microfox.app/ai-router/intro">
                <BookOpen className="w-4 h-4 mr-2" />
                Docs
                <ExternalLink className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Ai Router is a framework for orchestrating structured, multi-agent AI systems.
            Built on top of Vercel's AI SDK with the simplicity of Express.js and power of ADK.
          </p>
        </div>

        {/* Documentation Links Card */}
        {/* <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>
              Essential resources to get started with AI Router
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium">Getting Started</h4>
                <div className="space-y-2">
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/intro" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      Introduction
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/overview/quickstart" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      Quickstart Guide
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/overview/ai-router" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      Core Concepts
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="font-medium">Advanced Topics</h4>
                <div className="space-y-2">
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/foundation/agents" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      Building Agents
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/examples/perplexity-clone" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      Examples
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="justify-start h-auto p-2">
                    <Link 
                      href="https://docs.microfox.app/ai-router/api-reference/router" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-left"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      API Reference
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card> */}

        {/* Footer */}
        <div className="text-center mt-12 text-muted-foreground">
          <p>Built with ❤️ by the Microfox team</p>
        </div>
      </div>
    </div>
  );
}
