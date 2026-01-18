
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, BookOpen, ExternalLink, SplitIcon, PyramidIcon } from "lucide-react";
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
              Try it in Chat Studio
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/workflows">
              <PyramidIcon className="w-4 h-4 mr-2" />
              Test Workflows
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
            <Badge variant="secondary" className="text-sm px-4 py-2">
              <svg data-testid="geist-icon" height="16" stroke-linejoin="round" viewBox="0 0 16 16" width="16"><path d="M2.5 0.5V0H3.5V0.5C3.5 1.60457 4.39543 2.5 5.5 2.5H6V3V3.5H5.5C4.39543 3.5 3.5 4.39543 3.5 5.5V6H3H2.5V5.5C2.5 4.39543 1.60457 3.5 0.5 3.5H0V3V2.5H0.5C1.60457 2.5 2.5 1.60457 2.5 0.5Z" fill="currentColor"></path><path d="M14.5 4.5V5H13.5V4.5C13.5 3.94772 13.0523 3.5 12.5 3.5H12V3V2.5H12.5C13.0523 2.5 13.5 2.05228 13.5 1.5V1H14H14.5V1.5C14.5 2.05228 14.9477 2.5 15.5 2.5H16V3V3.5H15.5C14.9477 3.5 14.5 3.94772 14.5 4.5Z" fill="currentColor"></path><path d="M8.40706 4.92939L8.5 4H9.5L9.59294 4.92939C9.82973 7.29734 11.7027 9.17027 14.0706 9.40706L15 9.5V10.5L14.0706 10.5929C11.7027 10.8297 9.82973 12.7027 9.59294 15.0706L9.5 16H8.5L8.40706 15.0706C8.17027 12.7027 6.29734 10.8297 3.92939 10.5929L3 10.5V9.5L3.92939 9.40706C6.29734 9.17027 8.17027 7.29734 8.40706 4.92939Z" fill="currentColor"></path></svg>
              Ai SDK
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
