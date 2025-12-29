/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import {
    Bot,
    ChevronRight,
    CircleCheck,
    FileCheck,
    Flag,
    MessageSquare,
    MessagesSquare,
    PanelLeftIcon,
    Plus,
    LayoutDashboard,
    Store,
    KeyRound,
    Settings,
    ListIcon,
    Search,
    X,
    Triangle,
    BookIcon,
    SplitIcon,
    HomeIcon,
    GitPullRequest,
    CircleDot,
} from "lucide-react";
import { useParams, usePathname } from "next/navigation";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayout } from "@/components/studio/context/LayoutProvider";
import { useAppSession } from "@/components/studio/context/AppSessionProvider";
import dayjs from "dayjs";
import React from "react";
import { Input } from "@/components/ui/input";
import { ChatSession } from "@/app/api/studio/chat/sessions/chatSessionUpstash";


interface SidebarProps {
    isCollapsed: boolean;
    onCollapse?: (collapsed: boolean) => void;
}

interface NavigationItemProps {
    icon: React.ReactNode;
    collapsedIcon?: React.ReactNode;
    label: string;
    href?: string;
    hrefCallback?: (selectedProject: any) => string;
    onClick?: () => void;
    isCollapsed: boolean;
}

interface NavigationConfig {
    icon: React.ReactNode;
    collapsedIcon?: React.ReactNode;
    label: string;
    href?: string;
    attributes?: any;
    hrefCallback?: (selectedProject: any) => string;
    requiresProject?: boolean;
    onClick?: (props: {
        isCollapsed: boolean;
        onCollapse?: (collapsed: boolean) => void;
        setIsFeedbackModalOpen: (open: boolean) => void;
    }) => void;
}

const navigationConfig: NavigationConfig[] = [
    {
        icon: <HomeIcon strokeWidth={2.5} className={cn("h-4 w-4")} />,
        collapsedIcon: (
            <HomeIcon strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
        ),
        label: "Home",
        href: "/studio",
    },
    {
        icon: <SplitIcon strokeWidth={2.5} className={cn("h-4 w-4")} />,
        collapsedIcon: (
            <SplitIcon strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
        ),
        label: "Agent Map",
        href: "/studio/agent-map",
    },
    // {
    //     icon: <Triangle strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //     collapsedIcon: (
    //         <Triangle strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //     ),
    //     label: "Agent Map",
    //     href: "/studio/agent-map",
    // },
    {
        icon: <BookIcon strokeWidth={2.5} className={cn("h-4 w-4")} />,
        collapsedIcon: (
            <BookIcon strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
        ),
        label: "Read Docs",
        href: "https://docs.microfox.app/ai-router/overview/why",
    },
    {
        icon: <CircleDot strokeWidth={2.5} className={cn("h-4 w-4")} />,
        collapsedIcon: (
            <CircleDot strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
        ),
        label: "Report Issue",
        href: "https://github.com/microfox-ai/ai-router/issues",
    },
    // {
    //     icon: <LayoutDashboard strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //     collapsedIcon: (
    //         <LayoutDashboard strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //     ),
    //     label: "Playground",
    //     href: "/",
    // },
    // {
    //   requiresProject: true,
    //   icon: <ListIcon strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //   collapsedIcon: (
    //     <ListIcon strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //   ),
    //   label: "All Running Tasks",
    //   hrefCallback: (selectedProject: BotProject) => `/project/${selectedProject?.id}/tasks`,
    // },
    // {
    //   icon: <Store strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //   collapsedIcon: (
    //     <Store strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //   ),
    //   label: "Store",
    //   href: "/store",
    // },
    // {
    //   icon: <FileCheck strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //   collapsedIcon: (
    //     <FileCheck strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //   ),
    //   label: "Whitepaper",
    //   href: "/whitepaper",
    // },
    // {
    //     icon: <Bot strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //     collapsedIcon: (
    //         <Bot strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //     ),
    //     label: "My Bots",
    //     href: "/my-bots",
    //     requiresProject: true,
    // },
    // {
    //     icon: <KeyRound strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //     collapsedIcon: (
    //         <KeyRound strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //     ),
    //     label: "Connections",
    //     href: "/my-data",
    //     requiresProject: true,
    // },
    // {
    //     requiresProject: true,
    //     icon: <Settings strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //     collapsedIcon: (
    //         <Settings strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //     ),
    //     label: "Settings",
    // },
    // {
    //   requiresProject: true,
    //   icon: <Flag strokeWidth={2.5} className={cn("h-4 w-4")} />,
    //   collapsedIcon: (
    //     <Flag strokeWidth={2.5} className={cn("h-[18px] w-[18px]")} />
    //   ),
    //   label: "Beta-Feedback",
    //   href: "/feedback",
    //   //attributes: FeatureBaseLinkAttributes,
    //   //onClick: ({ setIsFeedbackModalOpen }) => setIsFeedbackModalOpen(true),
    // },
    // {
    //   requiresProject: true,
    //   icon: (
    //     <MessagesSquare
    //       strokeWidth={2.2}
    //       className={cn("h-[1.1rem] w-[1.1rem]")}
    //     />
    //   ),
    //   collapsedIcon: (
    //     <MessageSquare strokeWidth={2.2} className={cn("h-[20px] w-[20px]")} />
    //   ),
    //   label: "Chat",
    //   onClick: ({ isCollapsed, onCollapse }) => {
    //     if (isCollapsed) {
    //       onCollapse?.(false);
    //     }
    //   },
    // },
];

export default function Sidebar({
    isCollapsed = false,
    onCollapse,
}: SidebarProps) {
    const { setIsFeedbackModalOpen } = useLayout();
    const { session, sessions, createNewEmptySession, sessionId } = useAppSession();

    return (
        <div
            className={`h-full flex-1 overflow-y-auto overflow-x-hidden bg-neutral-50 transition-all duration-300`}
        >
            <TooltipProvider>
                <div
                    className={`flex h-screen flex-col ${isCollapsed ? "px-2" : "px-4"}`}
                >
                    <SidebarHeader isCollapsed={isCollapsed} onCollapse={onCollapse} />

                    <div className="flex-1">

                        <NewRequestButton
                            isCollapsed={isCollapsed}
                            onNewRequest={() => createNewEmptySession()}
                            text="New Chat"
                        />
                        <ul
                            className={`${isCollapsed ? "flex flex-col items-center gap-2" : "flex flex-col"}`}
                        >
                            {navigationConfig
                                .map((item, index) => (
                                    <NavigationItem
                                        key={item.label}
                                        icon={item.icon}
                                        collapsedIcon={item.collapsedIcon}
                                        label={item.label}
                                        href={item.href}
                                        hrefCallback={item.hrefCallback}
                                        onClick={
                                            item.onClick
                                                ? () =>
                                                    item.onClick?.({
                                                        isCollapsed,
                                                        onCollapse,
                                                        setIsFeedbackModalOpen,
                                                    })
                                                : undefined
                                        }
                                        isCollapsed={isCollapsed}
                                        {...item.attributes}
                                    />
                                ))}
                        </ul>

                        {sessions.length > 0 && (
                            <RequestsList
                                clientRequests={sessions}
                                requestParamId={session?.id}
                                isCollapsed={isCollapsed}
                            />
                        )}
                    </div>

                </div>
            </TooltipProvider>
        </div>
    );
}

const NavigationItem = ({
    icon,
    collapsedIcon,
    label,
    href,
    hrefCallback,
    onClick,
    isCollapsed,
}: NavigationItemProps) => {
    const pathname = usePathname();
    const isActive = href ? pathname === href : false;

    const content = (
        <div className="flex items-center justify-between">
            <div
                className={`flex items-center gap-2 ${isActive ? "text-black" : "text-neutral-500"} group-hover:text-black transition-all duration-200`}
            >
                {!isCollapsed ? (
                    icon
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>{collapsedIcon || icon}</TooltipTrigger>
                        <TooltipContent
                            side="right"
                            className="bg-white !text-black border border-gray-300 text-xs rounded-full"
                            sideOffset={10}
                        >
                            {label}
                        </TooltipContent>
                    </Tooltip>
                )}
                {!isCollapsed && <span className="text-sm font-medium">{label}</span>}
            </div>
        </div>
    );

    return (
        <li
            className={`${isActive ? "bg-gray-200" : "hover:bg-gray-100"} rounded-lg cursor-pointer ${isCollapsed ? "p-2 w-full flex justify-center" : "p-2 px-3"} group`}
        >
            {href ? (
                <Link href={href} target={href.startsWith('http') ? '_blank' : undefined} className="flex items-center justify-between">
                    {content}
                </Link>
            ) : (
                <div onClick={onClick}>{content}</div>
            )}
        </li>
    );
};

const SidebarHeader = ({
    isCollapsed,
    onCollapse,
}: {
    isCollapsed?: boolean;
    onCollapse?: (collapsed: boolean) => void;
}) => {
    const pathname = usePathname();

    return (
        <div className="flex items-center justify-between mb-4">
            <div
                onClick={() => onCollapse?.(!isCollapsed)}
                className={`flex mt-4 cursor-pointer items-center ${isCollapsed ? "justify-center" : "gap-2"} text-2xl`}
            >
                <img
                    src="https://microfox.app/logo-mini-color.png"
                    alt=""
                    width={32}
                    height={32}
                    className={`rounded-md w-10 min-w-10 h-10 min-h-10 ${isCollapsed && "ml-1"}`}
                />
                {!isCollapsed && (
                    <div className="flex items-center gap-2">
                        <h1 className="font-medium text-xl text-gray-800">Microfox</h1>
                        <p className="text-xs font-medium text-gray-500 mt-1">v1.0.1</p>
                    </div>
                )}
            </div>
            {!isCollapsed && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e: any) => {
                        e.stopPropagation();
                        onCollapse?.(!isCollapsed);
                    }}
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    style={{ padding: "0.25rem" }}
                    className="opacity-50 hover:opacity-100 -mb-5"
                >
                    <PanelLeftIcon className="h-4" />
                </Button>
            )}
        </div>
    );
};

const RequestsList = ({
    clientRequests,
    requestParamId,
    isCollapsed,
}: {
    clientRequests: ChatSession[];
    requestParamId?: string;
    isCollapsed: boolean;
}) => {
    if (isCollapsed) return null;

    const [searchQuery, setSearchQuery] = React.useState("");
    const [searchResults, setSearchResults] = React.useState<ChatSession[] | null>(null);
    const [isSearching, setIsSearching] = React.useState(false);
    const [showSearch, setShowSearch] = React.useState(false);

    React.useEffect(() => {
        if (searchQuery.trim() === "") {
            setSearchResults(null);
            return;
        }

        const search = async () => {
            setIsSearching(true);
            try {
                const response = await fetch(`/api/studio/chat/sessions/search?q=${encodeURIComponent(searchQuery)}`);
                if (response.ok) {
                    const data = await response.json();
                    setSearchResults(data);
                } else {
                    setSearchResults([]);
                }
            } catch (error) {
                console.error("Failed to search requests", error);
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }

        const timer = setTimeout(() => {
            search();
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [searchQuery]);


    const renderDateSeparator = (currentDate: Date, prevDate?: Date) => {
        if (!prevDate || !dayjs(currentDate).isSame(prevDate, "day")) {
            return (
                <div className="my-2 px-2 text-center text-xs font-semibold text-gray-400">
                    {dayjs(currentDate).format("DD MMM YYYY")}
                </div>
            );
        }
        return null;
    };

    const requestsToDisplay = searchResults !== null ? searchResults : clientRequests;

    return (
        <div className="relative my-4 mx-1">
            {!showSearch ? (
                <div className="absolute -top-2 right-1 z-10">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowSearch(true)}
                        title="Search chats"
                        className="h-8 w-8"
                    >
                        <Search className="h-4 w-4 text-gray-500 hover:text-black" />
                    </Button>
                </div>
            ) : (
                <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    <Input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-8 h-9"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                setShowSearch(false);
                                setSearchQuery('');
                            }
                        }}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            setShowSearch(false);
                            setSearchQuery('');
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}
            <div className="space-y-1 max-h-[50vh] overflow-y-auto" style={{
                maxHeight: showSearch ? 'calc(50vh - 44px)' : '50vh'
            }}>
                {isSearching ? (
                    <div className="px-4 py-2 text-sm text-muted-foreground">Searching...</div>
                ) : requestsToDisplay?.length > 0 ? (
                    <>

                        <p className="text-sm text-gray-500">Chat History</p>
                        {requestsToDisplay?.map(
                            (request: ChatSession, index) => {
                                const prevRequest = requestsToDisplay[index - 1];
                                return (
                                    <React.Fragment key={request.id}>
                                        {renderDateSeparator(dayjs(request.createdAt).toDate(), dayjs(prevRequest?.createdAt).toDate())}
                                        <Link
                                            key={request?.id}
                                            href={`/studio/chat/${request?.id}`}
                                            className={`flex cursor-pointer w-full line-clamp-1 items-center rounded-sm px-2 py-2 text-sm ${request?.id === requestParamId
                                                ? "bg-gray-200 text-black"
                                                : "hover:bg-gray-100"
                                                }`}
                                        >
                                            {request.id === requestParamId ? (
                                                <ChevronRight
                                                    style={{
                                                        marginRight: "0.5rem",
                                                        height: "1rem",
                                                        width: "1rem",
                                                    }}
                                                />
                                            ) : (
                                                <MessageSquare
                                                    style={{
                                                        marginRight: "0.5rem",
                                                        height: "1rem",
                                                        width: "1rem",
                                                        color: "#4c4c4c",
                                                    }}
                                                />
                                            )}
                                            <span
                                                className={`flex-1 truncate text-left ${request.id === requestParamId ? "font-semibold" : ""}`}
                                            >
                                                {request.title}
                                            </span>
                                        </Link>
                                    </React.Fragment>
                                )
                            }
                        )}
                    </>

                ) : (
                    <div className="px-4 py-2 text-sm text-muted-foreground">
                        No requests
                    </div>
                )}
            </div>
        </div>
    );
};

const NewRequestButton = ({
    isCollapsed,
    onNewRequest,
    text,
}: {
    isCollapsed: boolean;
    onNewRequest: () => void;
    text: string;
}) => {
    if (isCollapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        onClick={(e: any) => {
                            e.stopPropagation();
                            onNewRequest();
                        }}
                        className={cn(
                            "cursor-pointer w-fit mx-auto my-4 rounded-full shadow-sm p-2 border border-gray-300 flex items-center justify-center",
                            isCollapsed && "my-5"
                        )}
                    >
                        <Plus className="h-5 w-5" />
                    </div>
                </TooltipTrigger>
                <TooltipContent
                    side="right"
                    className="bg-white !text-black border border-gray-300 text-xs rounded-full"
                    sideOffset={10}
                >
                    <p>{text}</p>
                </TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Button
            variant="outline"
            onClick={(e: any) => {
                e.stopPropagation();
                onNewRequest();
            }}
            className="w-full my-4 rounded-full shadow-md overflow-hidden bg-black text-white hover:bg-black/80 hover:text-white"
            style={{ padding: "0.25rem", marginRight: "0.25rem" }}
        >
            {text}
        </Button>
    );
};
