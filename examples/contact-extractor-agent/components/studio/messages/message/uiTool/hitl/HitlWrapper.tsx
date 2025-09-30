// import { UiComponentProps } from "../mappers/UiComponentProps"
// import { parseMcpType } from "../mappers/uiHitl"
// import { HitlInput, MyUiTool } from "../mappers/uiTool"
// import { useAppSession } from "@/components/context/AppSessionProvider"
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
// import { cn } from "@/lib/utils"
// import { AgentInfo } from "@microfox/types"
// import { ChevronDown, HelpCircleIcon } from "lucide-react"
// import { useEffect, useState } from "react"
// import useSWR from "swr"
// import { Package } from "../../types"
// import { TaskIntegrations } from "../card/task_integrations/TaskIntegrations"
// import { useHitl } from "./HitlProvider"
// import { SecretSelectorForAuth } from "./SecretSelectorForAuth"

// export const HitlAuthWrapper = ({ tool, lastMessage, lastAnnotationIndices, messageIndex, children }: {
//     tool: MyUiTool & {
//         type: `tool-ui-${keyof UiComponentProps}` | `tool-${string}`
//     },
//     lastMessage: boolean
//     lastAnnotationIndices: Map<string, number>,
//     messageIndex: number
//     children: React.ReactNode
// }) => {
//     const { session } = useAppSession();
//     const auth = (tool.output as HitlInput).auth;
//     const { auth: stateAuth, setAuth, selectSecret, refetchHitlAuth } = useHitl();
//     const [popoverOpen, setPopoverOpen] = useState(false);
//     const { mcpType, mcpName, toolName } = parseMcpType(tool.type);
//     const [expanded, setExpanded] = useState(false);

//     const { data: packageInfos, mutate: mutatePackageInfos } = useSWR<Package[]>(
//         auth ? `/api/packages/infos?packageNames=${auth?.secrets?.map(s => s.packageName).join(",")}` : null,
//         async (url: string) => {
//             const res = await fetch(url);
//             if (!res.ok) throw new Error("Failed to fetch packages");
//             return res.json();
//         }, {
//         revalidateOnFocus: false,
//     });

//     const { data: agentInfos, mutate: mutateAgentInfos } = useSWR<AgentInfo[]>(
//         `/api/agents/infos?agentNames=${mcpName}`,
//         async (url: string) => {
//             const res = await fetch(url);
//             if (!res.ok) throw new Error("Failed to fetch agents");
//             return res.json();
//         }, {
//         revalidateOnFocus: false,
//     });
//     const agentInfo = agentInfos?.find(a => a.agentName === mcpName);

//     const isSinglePackage = stateAuth?.secrets?.length === 1;
//     const singlePackageSecret = stateAuth?.secrets[0];
//     const singlePackage = packageInfos?.find(p => p.name === singlePackageSecret?.packageName);
//     const selectedSinglePackageSecret = singlePackageSecret?.secrets.find(s => s.id === singlePackageSecret?.selectedSecretId);

//     const missingSecrets = stateAuth?.secrets?.filter(s => !s.selectedSecretId && s.isAuthNeeded);

//     useEffect(() => {
//         if (auth) {
//             setAuth(auth);
//         }
//     }, [auth?.secrets]);

//     if (!stateAuth) {
//         return <div>{children}</div>
//     };


//     if (missingSecrets && missingSecrets?.length > 0) {
//         return (
//             <div className="flex flex-col my-2 bg-white shadow-md rounded-xl border border-gray-200">
//                 <div className="flex flex-row items-end justify-start gap-2 border-b border-gray-200 pt-3 px-3">
//                     <img src="/logo-mini-color.png" alt="Secret Icon" className="w-18 h-18" />
//                     <div className="flex flex-col justify-end py-2 pl-4">
//                         <div className="flex flex-row items-center gap-2 mb-1">
//                             <h2 className="text-xl font-bold">Connect me.</h2>
//                             <TooltipProvider>
//                                 <Tooltip>
//                                     <TooltipTrigger asChild>
//                                         <HelpCircleIcon className="w-4 h-4 text-gray-500 cursor-pointer" />
//                                     </TooltipTrigger>
//                                     <TooltipContent className="max-w-[300px]">
//                                         <p>Microfox will always ask you permission before doing any action.</p>
//                                     </TooltipContent>
//                                 </Tooltip>
//                             </TooltipProvider>
//                         </div>
//                         <h3 className="text-sm text-gray-500">Hey ! Can you give me access,<br /> i need it to finish your request.</h3>
//                     </div>
//                 </div>
//                 <div className="p-4">
//                     <TaskIntegrations
//                         buttons={[]}
//                         object={{
//                             objectType: "task_integrations",
//                             object: {
//                                 platforms: missingSecrets.map(s => ({
//                                     name: packageInfos?.find(p => p.name === s.packageName)?.title ?? s.packageName,
//                                     reason: s.reason ?? "",
//                                     optional: false,
//                                     package: s.packageName,
//                                     scopes: s.scopes ?? [],
//                                 })),
//                             },
//                         }}
//                         onAllSecretsFilled={() => {
//                             refetchHitlAuth();
//                         }}
//                         hideMetaInfo={true}
//                         hideButtons={true}
//                         text=""
//                         isLastInQueue={true}
//                         lastMessage={false}
//                     />
//                 </div>
//             </div>
//         )
//     }


//     return <div className="flex flex-col my-2 bg-white shadow-md rounded-xl border border-gray-200">

//         <div className="flex flex-col w-full">
//             <div
//                 className="flex flex-row items-start justify-between gap-2 border-b border-gray-200 py-3 px-3 cursor-pointer"
//             >
//                 <TooltipProvider>
//                     <Tooltip>
//                         <TooltipTrigger asChild>
//                             <div className="flex flex-row gap-2 items-center">
//                                 {agentInfo?.iconUrl && (
//                                     <img src={agentInfo.iconUrl} alt={agentInfo.title} className="w-6 h-6 rounded-full" />
//                                 )}
//                                 <span className="text-sm text-muted-foreground">
//                                     {agentInfo?.title ?? mcpName}
//                                 </span>
//                             </div>
//                         </TooltipTrigger>
//                         {agentInfo?.description && (
//                             <TooltipContent className="max-w-[300px]">
//                                 <p>{agentInfo.description}</p>
//                             </TooltipContent>
//                         )}
//                     </Tooltip>
//                 </TooltipProvider>
//                 <TooltipProvider>
//                     <div className="flex flex-row gap-2 items-center"
//                         onClick={() => setExpanded(!expanded)}
//                     >
//                         {stateAuth.secrets?.map((s) => {
//                             const packageInfo = packageInfos?.find(p => p.name === s.packageName);
//                             return (
//                                 <Tooltip>
//                                     <TooltipTrigger asChild>
//                                         <img
//                                             src={packageInfo?.icon ?? "/favicon_io/favicon.ico"} alt="Project Logo" className="w-4 h-4 rounded-full cursor-pointer" />
//                                     </TooltipTrigger>
//                                     <TooltipContent className="max-w-[300px]">
//                                         <p>{packageInfo?.name}</p>
//                                     </TooltipContent>
//                                 </Tooltip>
//                             )
//                         })}
//                         {/* <h3 className="text-sm text-muted-foreground">{stateAuth.secrets?.length} Connections</h3> */}
//                         <ChevronDown className={cn("min-w-2 min-h-2 text-gray-500 transition-transform", expanded && "rotate-180")} />
//                     </div>
//                 </TooltipProvider>
//             </div>
//             {(expanded) && (
//                 <div className="flex flex-col w-full">
//                     {stateAuth.secrets?.map((s) => {
//                         const packageInfo = packageInfos?.find(p => p.name === s.packageName);
//                         if (!packageInfo) return null;
//                         return (
//                             <SecretSelectorForAuth
//                                 key={s.packageName}
//                                 packageAuth={s}
//                                 packageInfo={packageInfo}
//                                 onSelectSecret={selectSecret}
//                                 refetchSecrets={refetchHitlAuth}
//                             />
//                         )
//                     })}
//                 </div>
//             )}
//         </div>
//         {/* <h4 className="text-lg font-bold">{auth.metadata.summary}</h4>
//         <div className="text-sm text-gray-500">
//             {auth.metadata.description} So, can i call the tool {Object.keys(auth.args)?.length > 0 ? "with the below args?" : "?"}
//         </div>
//         {Object.keys(auth.args)?.length > 0 &&
//             (<div className="font-mono bg-gray-200 p-2 rounded text-xs">
//                 {JSON.stringify(auth.args, null, 2)}
//             </div>
//             )} */}
//         <div className="flex">
//             {children}
//         </div>
//     </div >
// }