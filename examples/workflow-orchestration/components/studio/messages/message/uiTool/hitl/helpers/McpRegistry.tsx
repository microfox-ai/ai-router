// import React, { useState } from 'react';
// import { parseMcpType } from '../../mappers/uiHitl';
// import GenericMcpRenderer from './GenericMcpRenderer';
// import SlackToolRenderer from '../slack/SlackToolRenderer';
// import { useHitl } from '../HitlProvider';

// interface McpRegistryProps {
//     tool: any;
//     input: any;
//     metadata: any;
//     placement: 'sidebar' | 'in-accept-box';
// }

// export const shouldShowReviewAction = (tool: any) => {
//     const { mcpName, toolName } = parseMcpType(tool.type);
//     return mcpName === 'slack' && (toolName === 'messageMultipleUsers' || toolName === 'messageMultipleChannels' || toolName === 'addUsersToChannel');
// }

// const McpRegistry: React.FC<McpRegistryProps> = ({ tool, input, metadata, placement = 'in-accept-box' }) => {
//     const { mcpName, toolName } = parseMcpType(tool.type);
//     const { mutatedInput, mutateInput } = useHitl();

//     const _shouldShowReviewAction = shouldShowReviewAction(tool);

//     if (placement === 'in-accept-box' && _shouldShowReviewAction) {
//         if (mcpName === 'slack') {
//             return (
//                 <div className='hidden invisible'>
//                     <SlackToolRenderer
//                         toolName={toolName as any}
//                         input={mutatedInput ?? input}
//                         onInputChange={(newInput) => {
//                             console.log("onInputChange", newInput);
//                             mutateInput(newInput);
//                         }}
//                     />
//                 </div>
//             )
//         }
//     }

//     // Check if this is a Slack tool
//     if (mcpName === 'slack') {
//         return (
//             <SlackToolRenderer
//                 toolName={toolName as any}
//                 input={mutatedInput ?? input}
//                 onInputChange={(newInput) => {
//                     console.log("onInputChange", newInput);
//                     mutateInput(newInput);
//                 }}
//             />
//         );
//     }

//     // Fall back to generic renderer
//     return (
//         <GenericMcpRenderer
//             input={input}
//             metadata={metadata}
//             mcpName={mcpName}
//             toolName={toolName}
//         />
//     );
// };

// export default McpRegistry;
