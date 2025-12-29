

"use client";

import { RestSdk } from "@/lib/studio/services/RestSdk";
import { useParams, useRouter } from "next/navigation";
import {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useState
} from "react";
import { ChatSession } from "@/app/api/studio/chat/sessions/chatSessionUpstash";
import { toast } from "sonner";
import useSWR from "swr";
import useLocalState from "./hooks/useLocalState";
import dayjs from "dayjs";


export const constructAutoSubmitMessage = (autoSubmit: string) => {
    return {
        id: crypto.randomUUID(),
        content: autoSubmit,
        role: "user" as const,
        parts: [
            {
                type: "text" as const,
                text: autoSubmit,
            },
        ],
    };
};

type AppSessionContext = ReturnType<typeof useAppSessionContext>;

const AppSessionContext = createContext<
    AppSessionContext | undefined
>(undefined);

function useAppSessionContext(sessionId?: string) {
    const [selectedSession, setSelectedSession] =
        useLocalState<ChatSession | null>("selectedSession", null);
    const router = useRouter();


    const [submitMetadata, setSubmitMetadata] = useState<any>({});
    const [autoSubmit, setAutoSubmit] = useState<string | null>(null);


    const {
        data: sessions = [],
        error,
        isLoading,
        mutate: mutateSessions,
    } = useSWR<ChatSession[]>(
        `/api/studio/chat/sessions`,
        async (url: string) => await fetch(url).then((res) => res.json())
    );

    useEffect(() => {
        if (sessionId && sessionId != "undefined" && sessions.length > 0) {
            setSelectedSession(sessions.find((session) => session.id === sessionId) ?? null);
        }
    }, [sessionId, sessions]);

    const createNewEmptySession = async (
        metadata?: any,
        _autoSubmit?: string
    ) => {

        toast.promise(
            RestSdk.postData(`/api/studio/chat/sessions`, {
                metadata: metadata ?? {},
                autoSubmit: _autoSubmit ?? null,
            }),
            {
                loading: "Starting new session...",
                success: (newRequest) => {
                    if (!newRequest) {
                        return "Failed to create session. Please try again.";
                    }
                    console.log("newRequest", newRequest);
                    setSelectedSession(newRequest);
                    setSubmitMetadata(metadata ?? {});
                    setAutoSubmit(_autoSubmit ?? null);
                    mutateSessions();
                    router.push(
                        `/studio/chat/${newRequest.id}`
                    );
                    return "Session created successfully!";
                },
                error: "Failed to create session. Please try again.",
            }
        );
    };



    return {
        sessionId: sessionId ?? selectedSession?.id ?? null,
        session: selectedSession,
        sessions: sessions?.sort((a, b) => dayjs(b.createdAt).toDate().getTime() - dayjs(a.createdAt).toDate().getTime()),
        isLoading: isLoading,
        createNewEmptySession,
        setSelectedSession,
        mutateSessions,
        submitMetadata,
        setSubmitMetadata,
        autoSubmit,
        setAutoSubmit,
    };
}

export function useAppSession() {
    const context = useContext(AppSessionContext);
    if (context === undefined) {
        throw new Error(
            "useAppSession must be used within a AppSessionProvider"
        );
    }
    return context;
}

interface ClientProjectProviderProps {
    children: ReactNode;
    sessionId?: string;
}

export function AppSessionProvider({
    children,
    sessionId,
}: ClientProjectProviderProps) {
    const value = useAppSessionContext(sessionId);
    return (
        <AppSessionContext.Provider value={value}>
            {children}
        </AppSessionContext.Provider>
    );
}
