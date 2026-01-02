import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { PyramidIcon, Zap } from "lucide-react";
import { useState } from "react";


const speedTabs = [
    {
        value: "fast",
        label: "Fast Action",
        icon: <Zap className="w-4 h-4" />
    },
    {
        value: "deep",
        label: "Deep Think",
        icon: <PyramidIcon className="w-4 h-4" />
    },
]


export const ToolSpeed = () => {
    //const { toolMode, setToolMode } = useAppChat();
    const [toolMode, setToolMode] = useState<"fast" | "deep">("fast");

    return (
        <TooltipProvider>
            <div
                className="relative flex bg-gray-100 p-[3px] h-11 rounded-lg">
                {speedTabs.map((tab, _idx) => (
                    <Tooltip key={`tab-${tab.value}-${_idx}`}>
                        <TooltipTrigger>
                            <div
                                key={`tab-${tab.value}`}
                                onClick={() => {
                                    console.log("setting tool mode to", tab.value);
                                    setToolMode(tab.value as "fast" | "deep")
                                }}
                                className="cursor-pointer relative duration-300 !shadow-none h-9 data-[state=active]:bg-transparent data-[state=active]:shadow-none z-10 flex items-center gap-2 px-2 py-2 text-sm font-medium text-gray-600 rounded-lg transition-all"
                            >
                                <motion.div
                                    className="flex items-center gap-2"
                                    // animate={{
                                    //     rotate: (toolMode === tab.value && toolMode === tab.value) ? 360 : 0
                                    // }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                >
                                    {tab.icon}
                                </motion.div>
                                {toolMode === tab.value && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute -z-[1] inset-0 bg-white rounded-lg"
                                        animate={{
                                            translateX: (toolMode === tab.value && toolMode === tab.value) ? 0 : 0
                                        }}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            {tab.label}
                        </TooltipContent>
                    </Tooltip>
                ))}
            </div >
        </TooltipProvider>
    )
}