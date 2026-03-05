// import React, { useEffect, useState } from 'react';
// import { getActiveUsersIds, getChannelsIds } from '../slack/dataFetchers';
// import McpRenderer from './McpRenderer';
// import { useClientProject } from '@/components/screens/providers/ClientProjectProvider';

// interface SlackMcpRendererProps {
//     toolName: string;
//     input: any;
//     metadata: any;
//     mcpName: string;
// }

// const SlackMcpRenderer: React.FC<SlackMcpRendererProps> = ({ input, metadata }) => {
//     const [users, setUsers] = useState<{ value: string, label: string }[]>([]);
//     const [channels, setChannels] = useState<{ value: string, label: string }[]>([]);
//     const [loading, setLoading] = useState(true);
//     const [useEnhanced, setUseEnhanced] = useState(false);
//     const { selectedRequest } = useClientProject();
    
//     useEffect(() => {
//         // Check if this tool needs user/channel data
//         const needsUsers = hasFieldType(metadata?.jsonSchema, ['userId', 'userIds']);
//         const needsChannels = hasFieldType(metadata?.jsonSchema, ['channelId', 'channelIds']);
        
//         if (needsUsers || needsChannels) {
//             setUseEnhanced(true);
//             fetchDropdownData(needsUsers, needsChannels);
//         } else {
//             setLoading(false);
//         }
//     }, [metadata]);

//     const hasFieldType = (schema: any, fieldNames: string[]): boolean => {
//         if (!schema?.properties) return false;
        
//         const checkProperties = (props: any): boolean => {
//             for (const [key, value] of Object.entries(props)) {
//                 if (fieldNames.some(name => key.toLowerCase().includes(name.toLowerCase()))) {
//                     return true;
//                 }
//                 if ((value as any)?.properties) {
//                     if (checkProperties((value as any).properties)) {
//                         return true;
//                     }
//                 }
//             }
//             return false;
//         };
        
//         return checkProperties(schema.properties);
//     };

//     const fetchDropdownData = async (needsUsers: boolean, needsChannels: boolean) => {
//         try {
//             setLoading(true);
//             const promises = [];
            
//             if (needsUsers) {
//                 promises.push(getActiveUsersIds(selectedRequest?.id));
//             }
//             if (needsChannels) {
//                 promises.push(getChannelsIds(selectedRequest?.id));
//             }

//             const results = await Promise.all(promises);
//             let resultIndex = 0;
            
//             if (needsUsers) {
//                 const usersData = results[resultIndex++] as any;
//                 if (usersData?.users) {
//                     setUsers(usersData.users.map((u: any) => ({ value: u.id, label: u.name })));
//                 }
//             }
            
//             if (needsChannels) {
//                 const channelsData = results[resultIndex++] as any;
//                 if (channelsData?.channels) {
//                     setChannels(channelsData.channels.map((c: any) => ({ value: c.id, label: c.name })));
//                 }
//             }
//         } catch (error) {
//             console.error('Failed to fetch Slack data:', error);
//         } finally {
//             setLoading(false);
//         }
//     };

//     if (loading) {
//         return <div className="text-sm text-gray-500">Loading Slack data...</div>;
//     }

//     return (
//         <div className="flex flex-col gap-4">
//             <McpRenderer
//                 input={input}
//                 metadata={metadata}
//             />
//         </div>
//     );
// };

// export default SlackMcpRenderer; 