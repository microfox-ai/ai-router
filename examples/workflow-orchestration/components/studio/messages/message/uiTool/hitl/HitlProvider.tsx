// "use client";

// import { HitlAuthObject } from "../mappers/uiTool";
// import { useAppSession } from "@/components/context/AppSessionProvider";
// import { RestSdk } from "@/utils/services/RestSdk";
// import { ClientSecret } from "@prisma/client";
// import {
//     createContext,
//     ReactNode,
//     useCallback,
//     useContext,
//     useState
// } from "react";
// import { useAppChat } from "@/components/context/AppChatProvider";

// type HitlContextType = ReturnType<typeof useHitlContext>;

// const HitlContext = createContext<HitlContextType | undefined>(undefined);

// function useHitlContext() {

//     const { addToolResult } = useAppChat();
//     const { session } = useAppSession();
//     const [auth, setAuth] = useState<HitlAuthObject | undefined>(undefined);
//     const [mutatedInput, setMutatedInput] = useState<any | undefined>(undefined);

//     const selectSecret = (secret: ClientSecret, packageName: string) => {
//         setAuth((as) => {
//             if (!as) return undefined;
//             const newAuthSecrets = [...as?.secrets ?? []];
//             const index = newAuthSecrets.findIndex((s) => s.packageName === packageName);
//             let updatedVariables = as?.variables ? as.variables : [];
//             if (index !== -1 && newAuthSecrets[index]) {
//                 // first remove the variables of the old secret
//                 // const oldSecret = newAuthSecrets[index].secrets.find((s) => s.id === newAuthSecrets[index]?.selectedSecretId);
//                 // if (oldSecret) {
//                 //     updatedVariables = removeVariables(updatedVariables, oldSecret);
//                 // }
//                 // // next carefully add the new variables (while overwriting if any)
//                 // updatedVariables = replaceVariables(updatedVariables, secret);
//                 newAuthSecrets[index] = {
//                     ...newAuthSecrets[index],
//                     packageName,
//                     selectedSecretId: secret.id,
//                 };
//             }
//             return {
//                 ...as,
//                 secrets: newAuthSecrets,
//                 //variables: updatedVariables,
//             };
//         })
//     }

//     const addHitlToolResult = useCallback((toolResult: any) => {
//         // console.log("addHitlToolResult", toolResult, "stateAuth", auth, "mutatedInput", mutatedInput);
//         addToolResult({
//             ...toolResult,
//             output: {
//                 ...toolResult.output,
//                 ...(mutatedInput && { mutatedInput }),
//                 auth: {
//                     ...toolResult.output.auth,
//                     ...auth,
//                 },
//             },
//         });
//         setMutatedInput(undefined);
//     }, [auth, mutatedInput]);

//     const refetchHitlAuth = () => {
//         RestSdk.postData("/api/client-secrets/hitl-auth", {
//             authOptions: {
//                 packages: auth?.secrets.map((s) => ({
//                     packageName: s.packageName,
//                     packageConstructor: s.packageConstructor,
//                 })),
//                 //customSecrets: auth?.
//             },
//             clientRequestId: session?.id,
//             // userId: session?.userId,
//         }).then((res) => {
//             console.log("REFETCHED AUTH", res);
//             setAuth(res);
//         }).catch((err) => {
//             console.error("Error fetching secrets", err);
//         });
//     }

//     const mutateInput = (_input: any) => {
//         console.log("mutateInput", _input);
//         setMutatedInput(_input);
//     }

//     return {
//         auth,
//         selectSecret,
//         setAuth,
//         addHitlToolResult,
//         refetchHitlAuth,
//         mutatedInput,
//         mutateInput,
//     };
// }

// export function useHitl() {
//     const context = useContext(HitlContext);
//     if (context === undefined) {
//         throw new Error("useHitl must be used within a HitlProvider");
//     }
//     return context;
// }

// interface HitlProviderProps {
//     children: ReactNode;
// }

// export function HitlProvider({ children }: HitlProviderProps) {
//     const value = useHitlContext();
//     return <HitlContext.Provider value={value}>{children}</HitlContext.Provider>;
// }
