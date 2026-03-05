import { useComponents } from "@/components/studio/context/ComponentProvider";
import { ToolUIPart } from "ai";
import { EyeOffIcon } from "lucide-react";

const map = [
    // {
    //     id: "ui",
    //     name: "ui",
    //     description: "To Render UI",
    // },
    {
        id: "input",
        name: "Input",
        description: "Renders input UI replacing the above header",
    },
    {
        id: "output",
        name: "Output",
        description: "Renders output UI replacing this gray box",
    },
    {
        id: "full",
        name: "Full",
        description: "Renders Full Componenet which replaces both",
    },
    // {
    //     id: "header",
    //     name: "Header",
    //     description: "To Render Header like replacing the above header UI box",
    // },
    // {
    //     id: "footer",
    //     name: "Footer",
    //     description: "To Render Footer like replacing the above footer UI box",
    // }
]

export const RenderToolOutput = ({ tool }: { tool: ToolUIPart<any> }) => {

    const { getToolComponent, aiRouterMetadata } = useComponents();
    const InputComponent = getToolComponent(tool.type, "input");
    if (InputComponent) {
        return <InputComponent tool={tool as any} />
    }


    const toolKey = tool.type.replace("tool-", "");
    const toolInfo = aiRouterMetadata[toolKey as keyof typeof aiRouterMetadata];

    // const outputUi = uiOutput?.uiOutput;
    // const isMainSupport = uiOutput?.uiOutput?.supports?.find((s) => s.type === "main");

    // // a placeholder UI for taskId type of outputs (if a match is done, update the message both on frontend & backend)
    // if (fullOutput.backgroundTask?.taskId) {
    //     return <TaskPlaceholder taskId={fullOutput.backgroundTask.taskId} fullOutput={fullOutput} mcpName={mcpName} toolName={toolName} />
    // }

    // switch (mcpName) {
    //     case "brave":
    //         switch (toolName) {
    //             case "webSearch":
    //                 return (
    //                     <div className="flex flex-col gap-2">
    //                         <BraveSourceHeader output={uiOutput.object?.brave} toolName={toolName} />
    //                         <BraveWebResults output={uiOutput.object?.brave} toolName={toolName} />
    //                         <BraveSourceBanner toolName={toolName} output={uiOutput.object?.brave} />
    //                     </div>
    //                 )
    //             case "imageSearch":
    //                 return <BraveMediaGrid toolName={toolName} output={uiOutput.object?.brave} />
    //         }
    //     case "puppeteer-sls":
    //         switch (toolName) {
    //             case "extractImagesFromURL":
    //                 return <BrowseMediaGrid toolName={toolName} output={mapBrowseImageSearch(fullOutput?.data)} />
    //         }
    //     case "ragreddit":
    //         // const uiFunctionString = TempMapper.toString();
    //         // const uiFunction = new Function('data', `return (${uiFunctionString})(data);`);
    //         // const data = uiFunction(fullOutput.data);
    //         //console.log("ragreddit", data, fullOutput.data, toolName);
    //         switch (toolName) {
    //             case "searchSubreddits":
    //                 return <InfoTable data={TempMapper(fullOutput.data)} />
    //             case "searchSubredditPosts":
    //                 return <InfoTable data={PostMapper(fullOutput.data)} />
    //         }
    //     // case "sparkboard":
    //     //     return SparkBoardMapper(toolName as any, fullOutput.data)
    // }

    // if (outputUi?.namespace === "common" && isMainSupport) {
    //     const uiFunctionString = isMainSupport?.mapperFunction;
    //     if (!uiFunctionString) {
    //         return null;
    //     }
    //     const uiFunction = new Function('data', `return (${uiFunctionString})(data);`);
    //     if (!uiFunction) {
    //         return null;
    //     }
    //     const uiMappedOutput = uiFunction(fullOutput.data);
    //     if (!uiMappedOutput) {
    //         return null;
    //     }
    //     switch (isMainSupport?.mapInNameSpace as keyof UiCommonTypes) {
    //         case "MediaGrid": {
    //             if (uiMappedOutput) {
    //                 return <MediaGrid images={uiMappedOutput.image_sources} />
    //             }
    //             return null;
    //         }
    //         case "InfoTable": {
    //             if (uiMappedOutput) {
    //                 // return <MediaGrid images={uiMappedOutput.image_sources} />
    //                 return <InfoTable data={uiMappedOutput} />
    //             }
    //             return null;
    //         }
    //     }
    // }
    // somehow get the uiNamespace from the agentInfo (without builking up the requestCount)
    return (
        <div className="relative flex flex-col gap-2 bg-neutral-50 rounded-xl py-15 px-15 gap-5 flex flex-col items-center justify-center max-w-xs sm:max-w-md">
            <EyeOffIcon className="w-4 h-4 text-neutral-800 absolute top-4 right-4" />
            <div className="flex flex-col">
                <h4 className="mb-0 pb-1"> No UI Configured for {toolInfo?.title} </h4>
                <p className="text-xs text-black mt-0"> tool-{toolInfo?.toolKey} {"->"} {toolInfo?.absolutePath} </p>
                <ul className="mt-4">
                    {map.map((info) => {
                        return <li className="text-xs text-gray-500" key={info.id}>{info.id} - {info.description}</li>
                    })}
                </ul>
            </div>
        </div>
    );
}