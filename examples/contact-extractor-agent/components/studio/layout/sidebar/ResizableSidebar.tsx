"use client";
import { ResizablePanel } from "@/components/ui/resizable";
import React from "react";
import { useLayout } from "@/components/studio/context/LayoutProvider";
import { useAppSession } from "@/components/studio/context/AppSessionProvider";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar";

export const ResizableSidebar = () => {
    const {
        isLeftCollapsed,
        isLeftTransitioning,
        leftPanelRef,
        handleLeftCollapse,
    } = useLayout();

    return (
        <ResizablePanel
            ref={leftPanelRef}
            collapsible={true}
            collapsedSize={4}
            minSize={4}
            maxSize={16}
            onCollapse={() => handleLeftCollapse(true)}
            onExpand={() => handleLeftCollapse(false)}
            className={cn(
                "z-50",
                "transition-all duration-100 linear"
            )}
        >
            <div className="flex h-full flex-col">
                <Sidebar
                    isCollapsed={isLeftCollapsed}
                    onCollapse={handleLeftCollapse}
                />
            </div>
        </ResizablePanel>
    );
};
