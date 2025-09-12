'use client';

import React, { useEffect, useState } from "react";
import { AiRouterTools } from "@/app/ai";
import { AnimationPlaybackControls, useAnimate, motion } from "framer-motion";
import { mapBraveWebSearch } from "../mapper";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { HoverSourcePopup } from "./header";
import { ToolUIPart } from "ai";
import { useMessageParts } from "@/components/studio/context/MessageProvider";


export const BraveSourceFooter = ({
    tool,
    isStickyRender
}: {
    tool: ToolUIPart<Pick<AiRouterTools, "braveResearchFast" | "braveResearchDeep">>
    isStickyRender?: boolean
}) => {
    const [scope, animate] = useAnimate();
    const [animationControls, setAnimationControls] =
        useState<AnimationPlaybackControls>();

    useEffect(() => {
        if (scope.current) {
            const controls = animate(
                scope.current,
                { x: ["0%", "-200%"] },
                {
                    ease: "linear",
                    duration: 20,
                    repeat: Infinity,
                },
            );
            setAnimationControls(controls);
        }
    }, [animate, scope]);

    if (!tool.output) {
        return null;
    }

    const { stickyUiParts, activePart, displayParts } = useMessageParts();
    const activePartIsText = activePart > 0 && displayParts[activePart - 1].type === "text";
    // if this is sticky render, only render if the active part is not text
    if (!activePartIsText && isStickyRender) {
        return null;
    }

    const toolOutput = mapBraveWebSearch(tool.output);

    if (!toolOutput) {
        return null;
    }

    const clubbedSources = [...(toolOutput?.web_sources ?? []), ...(toolOutput?.image_sources ?? []), ...(toolOutput?.video_sources ?? [])];

    const webSources = clubbedSources.map((source, idx) => (
        <HoverCard openDelay={0} key={source.url + idx}>
            <HoverCardTrigger asChild>
                <div className="flex min-w-[200px] bg-neutral-100 rounded-xl px-4 py-1 items-center justify-center">
                    <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-row gap-2 cursor-pointer items-center"
                    >
                        <img
                            src={source.meta_url?.favicon ?? ""}
                            alt={source.title}
                            className="w-4 h-4 rounded-full"
                        />
                        <span className="line-clamp-1 text-xs font-regular text-neutral-500">
                            {source.title}
                        </span>
                    </a>
                </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-80">
                <HoverSourcePopup source={source} />
            </HoverCardContent>
        </HoverCard>
    ));

    return (
        <div
            className="w-full my-4 mb-8 overflow-x-hidden [mask-image:linear-gradient(to_right,transparent,white_10%,white_90%,transparent)]"
            onMouseEnter={() => animationControls?.pause()}
            onMouseLeave={() => animationControls?.play()}
        >
            <motion.div ref={scope} className="flex gap-4">
                {webSources}
                {webSources.map((child) =>
                    React.cloneElement(child, { key: (child.key || '') + "-clone" }),
                )}
            </motion.div>
        </div>
    );

};