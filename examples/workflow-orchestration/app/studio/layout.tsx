"use client";

import { FileUploadProvider } from "@/components/studio/context/FileUploadProvider";
import { Suspense } from "react";
import { AppSessionProvider } from "@/components/studio/context/AppSessionProvider";
import { LayoutProvider } from "@/components/studio/context/LayoutProvider";
import { ResizablePanelGroup } from "@/components/ui/resizable";
import { ResizableSidebar } from "@/components/studio/layout/sidebar/ResizableSidebar";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import Head from "next/head";
import { useParams } from "next/navigation";


export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId;
  //   const sessionId = Array.isArray(slug) && slug.length > 1 ? slug[1] : undefined;
  if (process.env.NODE_ENV != "development") {
    return <div>Not allowed</div>
  }
  return (
    <>
      <Head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons&display=block"
          rel="stylesheet"
        ></link>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined&display=block"
          rel="stylesheet"
        ></link>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100..700,0,0&display=block"
        ></link>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </Head>
      <Suspense
        fallback={
          <div className="flex justify-center items-center overflow-hidden h-screen">
            <Loader2 className="w-full h-6 animate-spin" />
          </div>
        }
      >
        <FileUploadProvider>
          <AppSessionProvider sessionId={sessionId}>
            <LayoutProvider>
              <main className="relative flex max-h-screen overflow-hidden flex-col bg-background">
                {/* {!isPlayground && !isProject && <CustomBotsHeader />} */}
                <Toaster position="top-right" richColors duration={3000} />
                <ResizablePanelGroup
                  direction="horizontal"
                  autoSaveId="request-page"
                  className="!h-screen"
                >
                  <ResizableSidebar />
                  <>{children}</>
                </ResizablePanelGroup>
              </main>
            </LayoutProvider>
          </AppSessionProvider>
        </FileUploadProvider>
      </Suspense>
    </>
  )
}