// import { uiHitlMap } from './uiHitl';
// import { AgentUi } from '@microfox/types';

// export interface Button {
//   type: 'confirm' | 'deny';
//   text: string;
//   action?: {
//     id: string;
//     props?: any;
//     actionText: string;
//   };
//   className?: string;
// }

// export type CardObject = any;

// export interface UiComponentProps {
//   buttons_list: {
//     uiType: 'buttons_list';
//     isUISticky?: boolean;
//     buttonHeaderText?: string;
//     buttons: Button[];
//   };
//   card: {
//     uiType: 'card';
//     isUISticky?: boolean;
//     text: string;
//     description?: string;
//     reason?: string;
//     buttons?: Button[];
//     object?: CardObject;
//   };
//   hitl: {
//     uiType: 'hitl';
//   };
//   hitl_output: {
//     uiType: 'hitl_output';
//     uiOutput?: AgentUi['outputUi'];
//     object?: {
//       [key in keyof uiHitlMap]?: uiHitlMap[key];
//     };
//   };
// }
