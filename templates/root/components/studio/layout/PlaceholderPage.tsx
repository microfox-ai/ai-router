"use client";

import { useLayout } from "../context/LayoutProvider";
import { ResizablePanel } from "@/components/ui/resizable";

export const PlaceholderPage = ({
    title,
    description,
}: {
    title: string;
    description: string;
}) => {
    const {
        isLeftCollapsed,
        isRightCollapsed,
        isRightTransitioning,
        rightPanelRef,
        handleLeftCollapse,
        handleRightCollapse,
        handleLeftResizeHandleClick,
        handleRightResizeHandleClick,
        rightPanelContent,
    } = useLayout();

    return (
        <ResizablePanel
            defaultSize={isLeftCollapsed ? 96 : 84}
            minSize={isLeftCollapsed ? 96 : 84}
            maxSize={isLeftCollapsed ? 96 : 84}
            className={`flex h-screen flex-col items-center overflow-hidden justify-center
  `}
        >
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-sm text-gray-500">{description}</p>
        </ResizablePanel>
    )
}
