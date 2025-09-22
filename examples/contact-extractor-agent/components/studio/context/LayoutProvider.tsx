"use client";

import {
    createContext,
    useContext,
    useState,
    useRef,
    useCallback,
} from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import useLocalState from "./hooks/useLocalState";

interface LayoutContextType {
    isLeftCollapsed: boolean;
    isRightCollapsed: boolean;
    isLeftTransitioning: boolean;
    isRightTransitioning: boolean;
    leftPanelRef: React.RefObject<ResizablePrimitive.ImperativePanelHandle | null>;
    rightPanelRef: React.RefObject<ResizablePrimitive.ImperativePanelHandle | null>;
    handleLeftCollapse: (collapsed: boolean) => void;
    handleRightCollapse: (collapsed: boolean) => void;
    handleLeftResizeHandleClick: () => void;
    handleRightResizeHandleClick: () => void;
    isFeedbackModalOpen: boolean;
    setIsFeedbackModalOpen: (open: boolean) => void;
    rightPanelContent: React.ReactNode | null;
    setRightPanelContent: (content: React.ReactNode | null) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const LayoutProvider = ({ children }: { children: React.ReactNode }) => {
    const [isLeftCollapsed, setIsLeftCollapsed] = useState(
        false
    );
    const [isRightCollapsed, setIsRightCollapsed] = useState(
        true
    );
    const [isLeftTransitioning, setIsLeftTransitioning] = useState(false);
    const [isRightTransitioning, setIsRightTransitioning] = useState(false);
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    const [rightPanelContent, setRightPanelContent] =
        useState<React.ReactNode | null>(null);
    const leftPanelRef = useRef<ResizablePrimitive.ImperativePanelHandle | null>(
        null
    );
    const rightPanelRef = useRef<ResizablePrimitive.ImperativePanelHandle | null>(
        null
    );
    const transitionTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    const handleLeftCollapse = useCallback((collapsed: boolean) => {
        if (transitionTimeoutRef.current) {
            clearTimeout(transitionTimeoutRef.current);
        }

        setIsLeftTransitioning(true);
        if (leftPanelRef.current) {
            if (collapsed) {
                leftPanelRef.current.collapse();
            } else {
                leftPanelRef.current.expand();
            }
        }
        setIsLeftCollapsed(collapsed);

        transitionTimeoutRef.current = setTimeout(() => {
            setIsLeftTransitioning(false);
        }, 400);
    }, []);

    const handleRightCollapse = useCallback((collapsed: boolean) => {
        if (transitionTimeoutRef.current) {
            clearTimeout(transitionTimeoutRef.current);
        }

        setIsRightTransitioning(true);
        if (rightPanelRef.current) {
            if (collapsed) {
                rightPanelRef.current.collapse();
            } else {
                rightPanelRef.current.expand();
            }
        }
        setIsRightCollapsed(collapsed);

        transitionTimeoutRef.current = setTimeout(() => {
            setIsRightTransitioning(false);
        }, 400);
    }, []);

    const handleLeftResizeHandleClick = useCallback(() => {
        handleLeftCollapse(!isLeftCollapsed);
    }, [isLeftCollapsed, handleLeftCollapse]);

    const handleRightResizeHandleClick = useCallback(() => {
        handleRightCollapse(!isRightCollapsed);
    }, [isRightCollapsed, handleRightCollapse]);

    return (
        <LayoutContext.Provider
            value={{
                isLeftCollapsed,
                isRightCollapsed,
                isLeftTransitioning,
                isRightTransitioning,
                leftPanelRef,
                rightPanelRef,
                handleLeftCollapse,
                handleRightCollapse,
                handleLeftResizeHandleClick,
                handleRightResizeHandleClick,
                isFeedbackModalOpen,
                setIsFeedbackModalOpen,
                rightPanelContent,
                setRightPanelContent,
            }}
        >
            {children}
        </LayoutContext.Provider>
    );
};

export const useLayout = () => {
    const context = useContext(LayoutContext);
    if (context === undefined) {
        throw new Error("useLayout must be used within a LayoutProvider");
    }
    return context;
};
