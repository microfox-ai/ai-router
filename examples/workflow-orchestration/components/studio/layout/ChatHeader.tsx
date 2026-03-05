import { ChatSession } from "@/app/api/studio/chat/sessions/chatSessionUpstash";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { UIMessage } from "ai";
import {
    Code,
    History,
    LayoutDashboard,
    MessageSquare,
    RocketIcon
} from "lucide-react";

interface IChatHeaderProps {
    session: ChatSession | null;
    isLoading: boolean;
    isValidating: boolean;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    projectTitle?: string;
    messages: UIMessage[];
    isChatLoading: boolean;
}

const tabList = [
    {
        label: "Chat",
        value: "chat",
        icon: <MessageSquare />,
    },
    {
        label: "Dashboard ",
        value: "dashboard",
        icon: <LayoutDashboard />,
    },
    {
        label: "Code",
        value: "code",
        icon: <Code />,
    },
    {
        label: "History",
        value: "history",
        icon: <History />,
    },
    {
        label: "Publish",
        value: "publish",
        icon: <RocketIcon />,
    },
];

const ChatHeader = ({
    messages,
    session,
    isChatLoading,
    activeTab,
    projectTitle,
}: IChatHeaderProps) => {

    return (
        <div className="grid grid-cols-12 w-full min-h-14 items-start justify-between gap-2 px-4 pt-4 ml-4">
            <div className="col-span-4">
                {isChatLoading ? (
                    <Skeleton className="w-full h-6" />
                ) : (
                    <Breadcrumb>
                        <BreadcrumbList className="flex-nowrap">
                            <BreadcrumbItem>
                                <BreadcrumbLink className="hover:text-gray-500">
                                    {projectTitle}
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem className="truncate">
                                <BreadcrumbPage className="truncate">
                                    {session?.title}
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                )}
                {/* {IN_DEV && (
          <>
            <p className="text-xs text-gray-500">
              Request ID: {clientRequest?.id}
            </p>
            <p className="text-xs text-gray-500">
              Minion: {lastKnownMinionType}; Flow: {lastKnownMinionFlow} Status:{" "}
              {clientRequest?.archiveStatus} Region: {clientRequest?.awsRegion}
            </p>
          </>
        )} */}
            </div>

            {/* <div className="col-span-4 flex justify-start ">
                {messages.length > 0 && tabList.length > 1 && (
                    <TabsList className="relative  flex bg-gray-100 p-[3px] h-11 rounded-lg">
                        {tabList.map((tab) => (
                            <TabsTrigger
                                key={`tab-${tab.value}`}
                                value={tab.value}
                                className="relative duration-300 !shadow-none h-9 data-[state=active]:bg-transparent data-[state=active]:shadow-none z-10 flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 rounded-lg transition-all"
                            >
                                <motion.div
                                    animate={{
                                        x: activeTab === tab.value ? -4 : 0,
                                    }}
                                    className="flex items-center gap-2"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                >
                                    {tab.icon}
                                    {activeTab === tab.value && (
                                        <motion.span
                                            key={`label-${tab.value}`}
                                            initial={{ width: 0, opacity: 0 }}
                                            animate={{ width: "auto", opacity: 1 }}
                                            exit={{ width: 0, opacity: 0 }}
                                            className="overflow-hidden whitespace-nowrap"
                                        >
                                            {tab.label}
                                        </motion.span>
                                    )}
                                </motion.div>
                                {activeTab === tab.value && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute -z-[1] inset-0 bg-white rounded-lg"
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                )}
            </div> */}
            <div className="col-span-4 flex justify-end">
                {/* <LogoutElement /> */}
            </div>
        </div>
    );
};

export default ChatHeader;
