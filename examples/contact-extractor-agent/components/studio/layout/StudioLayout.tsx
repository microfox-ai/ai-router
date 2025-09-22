'use client';

import React from 'react';
import { ResizablePanelGroup } from '@/components/ui/resizable';
import { ResizableSidebar } from '@/components/studio/layout/sidebar/ResizableSidebar';
import { Toaster } from 'sonner';
import { FileUploadProvider } from '@/components/studio/context/FileUploadProvider';
import { Suspense } from 'react';
import { AppSessionProvider } from '@/components/studio/context/AppSessionProvider';
import { LayoutProvider } from '@/components/studio/context/LayoutProvider';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId;

  return (
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
  );
};
