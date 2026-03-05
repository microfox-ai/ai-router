// import React, { useEffect, useState } from 'react';
// import { Label } from '@/components/ui/label';
// import { Input } from '@/components/ui/input';
// import { Checkbox } from '@/components/ui/checkbox';
// import { Textarea } from '@/components/ui/textarea';
// import {
//     Select,
//     SelectContent,
//     SelectItem,
//     SelectTrigger,
//     SelectValue,
// } from '@/components/ui/select';
// import { Badge } from '@/components/ui/badge';
// import { XIcon, ChevronDown, ChevronRight, ExpandIcon, ListCollapseIcon } from 'lucide-react';
// import { useHitl } from '../HitlProvider';
// import { Button } from '@/components/ui/button';

// interface GenericMcpRendererProps {
//     input: any;
//     metadata: any;
//     mcpName: string;
//     toolName: string;
// }

// const GenericMcpRenderer: React.FC<GenericMcpRendererProps> = ({
//     input,
//     metadata,
//     mcpName,
//     toolName
// }) => {
//     const { mutateInput } = useHitl();
//     const [formData, setFormData] = useState(input || {});
//     const [isExpanded, setIsExpanded] = useState(false);

//     const parameterCount = metadata?.jsonSchema?.properties
//         ? Object.keys(metadata.jsonSchema.properties).filter(key => !key.startsWith('microfox')).length
//         : 0;

//     const handleFieldChange = (fieldPath: string, value: any) => {
//         const newFormData = { ...formData };
//         const pathParts = fieldPath.split('.');

//         let current = newFormData;
//         for (let i = 0; i < pathParts.length - 1; i++) {
//             const part = pathParts[i];
//             if (!part) continue; // Skip if undefined

//             if (!(part in current)) {
//                 current[part] = {};
//             }
//             current = current[part];
//         }
//         const lastPart = pathParts[pathParts.length - 1];
//         if (lastPart) {
//             current[lastPart] = value;
//         }

//         setFormData(newFormData);
//         mutateInput(newFormData);
//     };

//     const getFieldValue = (fieldPath: string) => {
//         const pathParts = fieldPath.split('.');
//         let current = formData;

//         for (const part of pathParts) {
//             if (current && typeof current === 'object' && part in current) {
//                 current = current[part];
//             } else {
//                 return undefined;
//             }
//         }
//         return current;
//     };

//     const renderField = (
//         fieldName: string,
//         schema: any,
//         fieldPath: string = fieldName,
//         isRequired: boolean = false
//     ) => {
//         const value = getFieldValue(fieldPath);
//         const description = schema.description || '';
//         const label = fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/([A-Z])/g, ' $1').trim();

//         // Skip microfox internal fields
//         if (fieldName.startsWith('microfox')) {
//             return null;
//         }

//         switch (schema.type) {
//             case 'string':
//                 if (description.length > 100 || fieldName.toLowerCase().includes('text') || fieldName.toLowerCase().includes('message')) {
//                     return (
//                         <div key={fieldPath} className="flex flex-col gap-2">
//                             <Label>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                             <Textarea
//                                 value={value || ''}
//                                 onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
//                                 placeholder={description}
//                                 rows={3}
//                             />
//                             {description && (
//                                 <div className="text-xs text-gray-500">{description}</div>
//                             )}
//                         </div>
//                     );
//                 }
//                 return (
//                     <div key={fieldPath} className="flex flex-col gap-2">
//                         <Label>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                         <Input
//                             value={value || ''}
//                             onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
//                             placeholder={description}
//                         />
//                         {description && (
//                             <div className="text-xs text-gray-500">{description}</div>
//                         )}
//                     </div>
//                 );

//             case 'number':
//             case 'integer':
//                 return (
//                     <div key={fieldPath} className="flex flex-col gap-2">
//                         <Label>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                         <Input
//                             type="number"
//                             value={value || ''}
//                             onChange={(e) => handleFieldChange(fieldPath, parseInt(e.target.value) || 0)}
//                             placeholder={description}
//                         />
//                         {description && (
//                             <div className="text-xs text-gray-500">{description}</div>
//                         )}
//                     </div>
//                 );

//             case 'boolean':
//                 return (
//                     <div key={fieldPath} className="flex items-center gap-2">
//                         <Checkbox
//                             id={fieldPath}
//                             checked={value || false}
//                             onCheckedChange={(checked) => handleFieldChange(fieldPath, checked)}
//                         />
//                         <Label htmlFor={fieldPath}>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                         {description && (
//                             <div className="text-xs text-gray-500 ml-2">{description}</div>
//                         )}
//                     </div>
//                 );

//             case 'array':
//                 if (schema.items?.type === 'string') {
//                     const arrayValue = value || [];
//                     return (
//                         <div key={fieldPath} className="flex flex-col gap-2">
//                             <Label>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                             <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[40px]">
//                                 {arrayValue.map((item: string, index: number) => (
//                                     <Badge key={index} variant="secondary" className="gap-1">
//                                         {item}
//                                         <button
//                                             onClick={() => {
//                                                 const newArray = arrayValue.filter((_: any, i: number) => i !== index);
//                                                 handleFieldChange(fieldPath, newArray);
//                                             }}
//                                         >
//                                             <XIcon className="w-3 h-3" />
//                                         </button>
//                                     </Badge>
//                                 ))}
//                             </div>
//                             <Input
//                                 placeholder={`Add ${label.toLowerCase()} (press Enter)`}
//                                 onKeyDown={(e) => {
//                                     if (e.key === 'Enter' && e.currentTarget.value.trim()) {
//                                         e.preventDefault();
//                                         const newArray = [...arrayValue, e.currentTarget.value.trim()];
//                                         handleFieldChange(fieldPath, newArray);
//                                         e.currentTarget.value = '';
//                                     }
//                                 }}
//                             />
//                             {description && (
//                                 <div className="text-xs text-gray-500">{description}</div>
//                             )}
//                         </div>
//                     );
//                 }
//                 break;

//             case 'object':
//                 const cleanedProps = Object.keys(schema.properties).filter((key) => !key.startsWith('microfox'));
//                 if (cleanedProps.length > 0) {
//                     return (
//                         <div key={fieldPath} className="flex flex-col gap-4 px-2 py-2 rounded-md">
//                             <Label className="font-semibold">{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                             {description && (
//                                 <div className="text-xs text-gray-500">{description}</div>
//                             )}
//                             <div className="flex flex-col gap-4">
//                                 {Object.entries(schema.properties).map(([propName, propSchema]: [string, any]) => {
//                                     const isSubRequired = schema.required?.includes(propName) || false;
//                                     return renderField(propName, propSchema, `${fieldPath}.${propName}`, isSubRequired);
//                                 })}
//                             </div>
//                         </div>
//                     );
//                 }
//                 break;

//             default:
//                 return (
//                     <div key={fieldPath} className="flex flex-col gap-2">
//                         <Label>{label} {isRequired && <span className="text-red-500">*</span>}</Label>
//                         <Input
//                             value={typeof value === 'string' ? value : JSON.stringify(value || '')}
//                             onChange={(e) => {
//                                 try {
//                                     const parsed = JSON.parse(e.target.value);
//                                     handleFieldChange(fieldPath, parsed);
//                                 } catch {
//                                     handleFieldChange(fieldPath, e.target.value);
//                                 }
//                             }}
//                             placeholder={description || `Enter ${label.toLowerCase()}`}
//                         />
//                         {description && (
//                             <div className="text-xs text-gray-500">{description}</div>
//                         )}
//                     </div>
//                 );
//         }
//     };

//     if (!metadata?.jsonSchema?.properties) {
//         return (
//             <div className="text-sm text-gray-500">
//                 No form fields available for this tool.
//             </div>
//         );
//     }

//     return (
//         <div className="border rounded-lg">
//             <div
//                 className="flex items-center justify-between cursor-pointer p-2"
//                 onClick={() => setIsExpanded(!isExpanded)}
//             >
//                 <div className="flex items-center gap-2">
//                     {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
//                     Filters
//                     <Badge variant="secondary" className="">
//                         {parameterCount}
//                     </Badge>
//                 </div>
//             </div>

//             {isExpanded && (
//                 <div className="flex flex-col gap-4 border-t pt-2 mt-2">
//                     {Object.entries(metadata.jsonSchema.properties).map(([fieldName, schema]: [string, any]) => {
//                         const isRequired = metadata.jsonSchema.required?.includes(fieldName) || false;
//                         return renderField(fieldName, schema, fieldName, isRequired);
//                     })}
//                 </div>
//             )}
//         </div>
//     );
// };

// export default GenericMcpRenderer; 