import React, { createContext, useContext, useState } from "react";

export type TabType = "chat" | "dashboard" | "history" | "code" | "publish";

interface TabUiContextType {
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    previousTab: TabType | null;
    setPreviousTab: (tab: TabType) => void;
    getSlideDirection: (tabValue: string) => number;
}

const TabUiContext = createContext<TabUiContextType | undefined>(undefined);

export const useTabUi = () => {
    const context = useContext(TabUiContext);
    if (!context) {
        throw new Error("useTabUi must be used within a TabUiProvider");
    }
    return context;
};

export const TabUiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeTab, setActiveTab] = useState<TabType>("chat");
    const [previousTab, setPreviousTab] = useState<TabType | null>(null);

    const getSlideDirection = (tabValue: string) => {
        if (!previousTab || previousTab === tabValue) return 0;
        const tabOrder = ["chat", "history", "dashboard"];
        const prevIndex = tabOrder.indexOf(previousTab);
        const currentIndex = tabOrder.indexOf(tabValue);
        return prevIndex < currentIndex ? 100 : -100;
    };

    const value = {
        activeTab,
        setActiveTab,
        previousTab,
        setPreviousTab,
        getSlideDirection,
    };

    return <TabUiContext.Provider value={value}>{children}</TabUiContext.Provider>;
};