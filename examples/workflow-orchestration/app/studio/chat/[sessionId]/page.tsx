"use client";

import { aiRouterTools } from "@/app/ai";
import { aiComponentMap } from "@/components/ai";
import { ChatPage } from "@/components/studio/layout/ChatPage";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";


const StudioRouter = () => {
    return (
        <Suspense fallback={<Loader2 className="w-full h-6 animate-spin" />}>
            <ChatPage componentMap={aiComponentMap} aiRouterTools={aiRouterTools} />
        </Suspense>
    )

}

export default StudioRouter;