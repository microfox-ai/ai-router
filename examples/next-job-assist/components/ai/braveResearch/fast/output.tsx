'use client';

import { AiRouterTools } from "@/app/ai";
import { InternalMarkdown } from "@/components/studio/global/markdown";
import { MediaGrid } from "@/components/studio/ui/media";
import { UiCommonTypes } from "@microfox/types";
import { ToolUIPart } from "ai";
import { ComponentType } from "react";
import { mapBraveWebSearch } from "../mapper";
import { WebSearchSource } from "../types";
import { BraveSourceFooter } from "./footer";
import { BraveSourceHeader } from "./header";
import { Inter, Krub } from 'next/font/google';
import { useLayout } from "@/components/studio/context/LayoutProvider";

const inter = Inter({ subsets: ['latin'] });
const krub = Krub({ subsets: ['latin'], weight: '400' });

export const BraveResults: ComponentType<{
    tool: ToolUIPart<Pick<AiRouterTools, "braveResearchFast" | "braveResearchDeep">>
}> = (props) => {

    const { tool } = props;
    const output = tool.output;

    if (!output) {
        return null;
    }

    if (output.searchType === 'image') {
        return <BraveMediaGrid tool={tool} />;
    }

    return (
        <div className="flex flex-col gap-2">
            <BraveSourceHeader tool={tool} />
            <BraveWebResults tool={tool} />
            <BraveSourceFooter tool={tool} />
        </div>
    )

}


export const BraveWebResults = ({
    tool,
}: {
    tool: ToolUIPart<Pick<AiRouterTools, "braveResearchFast" | "braveResearchDeep">>
}) => {

    if (!tool.output) {
        return null;
    }

    const data = mapBraveWebSearch(tool.output);

    if (!data || !("web_sources" in data) || !data.web_sources) {
        return null;
    }

    const webSources = data.web_sources;

    if (webSources.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-6">
            {webSources.map((source, idx) => (
                <div key={source.url + idx} className="group/web-result">
                    <div className="flex items-center gap-2 mb-1">
                        {source.meta_url?.favicon && (
                            <img
                                src={source.meta_url.favicon}
                                alt=""
                                className="w-6 h-6 p-1 bg-neutral-100 rounded-full"
                            />
                        )}
                        <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-col"
                        >
                            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                {source.meta_url?.hostname ?? new URL(source.url).hostname}
                            </span>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                {source.displayDate}
                            </span>
                        </a>
                    </div>
                    <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <h3 className={`${inter.className} text-lg line-clamp-1 font-semibold text-neutral-800 hover:underline dark:text-neutral-200 group-hover/web-result:underline`}>
                            {source.title}
                        </h3>
                    </a>
                    <p className={` text-sm text-neutral-500 dark:text-neutral-300 mt-1 line-clamp-3  `}>
                        <InternalMarkdown>{source.description ?? ""}</InternalMarkdown>
                    </p>
                </div>
            ))}
        </div>
    );
}

export const BraveMediaGrid = ({
    tool,
}: {
    tool: AiRouterTools["braveResearchFast"] | AiRouterTools["braveResearchDeep"]
}) => {
    if (!tool.output) {
        return null;
    }

    const data = mapBraveWebSearch(tool.output);
    if (data && data.image_sources.length > 0) {

        const images: UiCommonTypes["ImageSet"][] = data.image_sources.map((source: WebSearchSource) => ({
            src: source.thumbnail?.src ?? "",
            originalSrc: source.thumbnail?.originalSrc,
            title: source.title,
            url: source.url,
            description: source.description,
        }));

        return <MediaGrid images={images} />;
    }

    return null;
}