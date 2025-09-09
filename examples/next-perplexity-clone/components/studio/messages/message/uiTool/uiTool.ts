// import { AuthObject, ToolMetadata } from '@microfox/tool-kit';
// import { UiComponentProps } from './UiComponentProps';
// // import { ClientSecret } from "@prisma/client";
// import { AuthOptions } from '@microfox/tool-kit';

// type HitlAuthObject = AuthObject & {
//   customSecrets?: AuthOptions['customSecrets'];
//   secrets: {
//     packageName: string;
//     packageConstructor?: string;
//     // secrets: ClientSecret[];
//     secrets?: any[];
//     selectedSecretId?: string;
//     isAuthNeeded: boolean;
//     scopes?: string[];
//     reason?: string;
//   }[];
// };

// type HitlInput = {
//   uiComponent: string;
//   _humanIntervention: true;
//   args: any;
//   metadata: ToolMetadata;
//   auth: HitlAuthObject;
//   props: UiComponentProps[keyof UiComponentProps];
// };

// export type MyUiTool = {
//   input: {
//     uiType: string;
//     type: 'ui';
//     uiComponent: string;
//     props?: UiComponentProps[keyof UiComponentProps];
//   };
//   output?:
//     | {
//         type: 'ui';
//         uiComponent: string;
//         props: UiComponentProps[keyof UiComponentProps];
//         _humanIntervention?: boolean;
//       }
//     | HitlInput;
// };
