// import { ClientSecret } from "@prisma/client";
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Check, ChevronDown, HelpCircleIcon, XIcon } from "lucide-react";
// import { useState } from "react";
// import { Identity } from "@microfox/oauth-kit";
// import { ClientSecretVariable } from "@/server/types";
// import { cn } from "@/lib/utils";
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { Badge } from "@/components/ui/badge";
// import { Package } from "../../types";
// import { prettyPrintDuration, prettySinceTime } from "@/utils/helpers/prettyprint";
// import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
// import { TaskIntegrations } from "../card/task_integrations/TaskIntegrations";

// export type AuthSecretRequest = {
//     packageName: string;
//     secrets: ClientSecret[];
//     selectedSecretId?: string;
//     isAuthNeeded: boolean;
//     scopes?: string[];
//     reason?: string;
// };

// interface SecretSelectorForAuthProps {
//     packageAuth: AuthSecretRequest;
//     packageInfo: Package;
//     onSelectSecret: (secret: ClientSecret, packageName: string) => void;
//     refetchSecrets: () => void;
// }

// const fetchDisplayName = (secret: ClientSecret | undefined) => {
//     if (!secret) {
//         return "Unknown";
//     }
//     if (secret.identityMetadata as Identity && Object.keys(secret.identityMetadata as any).length > 0) {
//         const identity = secret.identityMetadata as Identity;
//         return identity.teamInfo?.name ?? identity.organisationInfo?.name ?? identity.userInfo?.name;
//     }
//     if (secret.name) {
//         return secret.name;
//     }
//     if (secret.updatedAt) {
//         return prettySinceTime(new Date(secret.updatedAt).toISOString());
//     }
//     return "Unknown";
// }

// const fetchDisplayIcon = (secret: ClientSecret | undefined) => {
//     if (!secret) {
//         return "/favicon_io/favicon.ico";
//     }
//     if (secret.identityMetadata as Identity) {
//         const identity = secret.identityMetadata as Identity;
//         return identity.teamInfo?.icon ?? identity.organisationInfo?.icon ?? identity.userInfo?.avatarUrl;
//     }
//     const botConfigVariables = secret.botConfig as any[] as ClientSecretVariable[];
//     const botConfigIcon = botConfigVariables.find(v => v.key.toLowerCase().includes("icon") || v.key.toLowerCase().includes("logo"));
//     if (botConfigIcon) {
//         return botConfigIcon.value;
//     }
//     return "/favicon_io/favicon.ico";
// }

// const fetchTooltipContent = (secret: ClientSecret | undefined): string => {
//     if (!secret) {
//         return "No secret is selected. Please select a secret to proceed.";
//     }
//     let content = "";
//     if (secret.packageType === "oauth2") {
//         const identity = secret.identityMetadata as Identity;
//         if (!identity) {
//             return "No identity is selected. Please select a secret to proceed.";
//         }
//         const name = identity.teamInfo?.name ?? identity.organisationInfo?.name ?? identity.userInfo?.name;
//         if (identity.teamInfo?.name && identity?.userInfo?.name) {
//             content += `This will use the connected account for team "${identity.teamInfo?.name}" which was first made by user "${identity.userInfo?.name}".`;
//         } else if (name) {
//             content += `This will use the connected account for "${name}".`;
//         } else {
//             content += "This will use the selected connected account.";
//         }
//     }
//     else if (secret.name) {
//         content += `This will use the API Key which was configured for bot nickname "${secret.name}".`;
//     }
//     else {
//         content += "This will use the selected secret.";
//     }
//     return content;
// }

// interface AddNewSecretDialogProps {
//     isOpen: boolean;
//     onClose: () => void;
//     packageAuth: AuthSecretRequest;
//     packageInfo: Package;
// }

// const AddNewSecretDialog = ({ isOpen, onClose, packageAuth, packageInfo }: AddNewSecretDialogProps) => {
//     return (
//         <Dialog open={isOpen} onOpenChange={onClose}>
//             <DialogContent>
//                 <div className="flex flex-col bg-white rounded-xl">
//                     <div className="flex flex-row items-end justify-start gap-2 border-b border-gray-200 pt-3 px-3">
//                         <img src="/logo-mini-color.png" alt="Secret Icon" className="w-18 h-18" />
//                         <div className="flex flex-col justify-end py-2 pl-4">
//                             <div className="flex flex-row items-center gap-2 mb-1">
//                                 <h2 className="text-xl font-bold">Connect me.</h2>
//                                 <TooltipProvider>
//                                     <Tooltip>
//                                         <TooltipTrigger asChild>
//                                             <HelpCircleIcon className="w-4 h-4 text-gray-500 cursor-pointer" />
//                                         </TooltipTrigger>
//                                         <TooltipContent className="max-w-[300px]">
//                                             <p>Microfox will always ask you permission before doing any action.</p>
//                                         </TooltipContent>
//                                     </Tooltip>
//                                 </TooltipProvider>
//                             </div>
//                             <h3 className="text-sm text-gray-500">Hey ! Can you give me access,<br /> i need it to finish your request.</h3>
//                         </div>
//                     </div>
//                     <div className="p-4">
//                         <TaskIntegrations
//                             buttons={[]}
//                             object={{
//                                 objectType: "task_integrations",
//                                 object: {
//                                     platforms: [{
//                                         name: packageInfo?.title ?? packageAuth.packageName,
//                                         reason: packageAuth.reason ?? "",
//                                         optional: false,
//                                         package: packageAuth.packageName,
//                                         scopes: packageAuth.scopes ?? [],
//                                     }],
//                                 },
//                             }}
//                             onAllSecretsFilled={() => {
//                                 onClose();
//                             }}
//                             hideMetaInfo={true}
//                             hideButtons={true}
//                             text=""
//                             isLastInQueue={true}
//                             lastMessage={false}
//                         />
//                     </div>
//                 </div>
//             </DialogContent>
//         </Dialog>
//     )
// }


// export const SecretSelectorForAuth = ({ packageAuth, packageInfo, onSelectSecret, refetchSecrets }: SecretSelectorForAuthProps) => {
//     const [popoverOpen, setPopoverOpen] = useState(false);
//     const selectedSecret = packageAuth.secrets.find(s => s.id === packageAuth.selectedSecretId);
//     const [addSecretOpen, setAddSecretOpen] = useState(false);

//     return (
//         <div className="flex flex-row items-start justify-between gap-2 border-b border-gray-200 py-3 px-3 w-full">
//             <div className="flex flex-row gap-2 items-center">
//                 <img src={packageInfo?.icon ?? "/favicon_io/favicon.ico"} alt="Project Logo" className="w-6 h-6 rounded-full" />
//                 <h3 className="text-sm ">{packageInfo?.title}</h3>
//             </div>
//             {selectedSecret && (
//                 <div className="flex flex-row gap-2 items-center">
//                     <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
//                         <PopoverTrigger asChild>
//                             <div className="flex flex-row gap-2 text-black border border-gray-200 rounded-xl px-3 py-0 items-center cursor-pointer">
//                                 <img src={fetchDisplayIcon(selectedSecret)} alt="Secret Icon" className="w-4 h-4 rounded-full" />
//                                 <h3 className="text-sm text-muted-foreground">{fetchDisplayName(selectedSecret)}</h3>
//                                 <ChevronDown className="min-w-4 min-h-4 text-gray-500 mr-2" />
//                             </div>
//                         </PopoverTrigger>
//                         <PopoverContent className="p-0 rounded-xl">
//                             <div className="flex flex-col max-h-[250px] overflow-y-auto rounded-xl">
//                                 {packageAuth.secrets.map(s => (
//                                     <div
//                                         onClick={() => {
//                                             onSelectSecret(s, packageAuth.packageName);
//                                             setPopoverOpen(false);
//                                         }}
//                                         key={s.id} className={cn("flex flex-row gap-2 items-center hover:bg-gray-100 p-2 rounded-xl cursor-pointer", s.id === packageAuth.selectedSecretId && "bg-gray-100")}>
//                                         <img src={fetchDisplayIcon(s)} alt="Secret Icon" className="w-4 h-4 rounded-full" />
//                                         <h3 className="text-sm text-muted-foreground">{fetchDisplayName(s)}</h3>
//                                         <Badge variant="outline" className="ml-2">
//                                             <span className="text-[0.8em]">{s.packageType === "oauth2" ? "Connected" : "API Key"}</span>
//                                         </Badge>
//                                         {
//                                             s.id === packageAuth.selectedSecretId && (
//                                                 <Check className="ml-auto w-4 h-4 text-green-500" />
//                                             )
//                                         }
//                                     </div>
//                                 ))}
//                                 <div
//                                     onClick={() => {
//                                         setAddSecretOpen(true);
//                                         setPopoverOpen(false);
//                                     }}
//                                     className="flex flex-row gap-2 items-center hover:bg-gray-100 p-2 rounded-xl cursor-pointer">
//                                     <h3 className="text-sm text-muted-foreground">Add new secret</h3>
//                                 </div>
//                             </div>
//                         </PopoverContent>
//                     </Popover>
//                     <TooltipProvider>
//                         <Tooltip>
//                             <TooltipTrigger asChild>
//                                 <HelpCircleIcon className="w-4 h-4 text-gray-500 cursor-pointer" />
//                             </TooltipTrigger>
//                             <TooltipContent className="max-w-[300px]">
//                                 <p>{fetchTooltipContent(selectedSecret)}</p>
//                             </TooltipContent>
//                         </Tooltip>
//                     </TooltipProvider>
//                 </div>
//             )}
//             <AddNewSecretDialog
//                 isOpen={addSecretOpen}
//                 onClose={() => {
//                     setAddSecretOpen(false);
//                     refetchSecrets();
//                 }}
//                 packageAuth={packageAuth}
//                 packageInfo={packageInfo}
//             />
//         </div>
//     )
// } 