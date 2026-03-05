"use client";

import { StudioConfig } from "@/microfox.config";
import { createContext, ReactNode, useContext, useState } from "react";
import { toast } from "sonner";

export type AttachedMedia = {
    file: File;
    preview: string;
};

export type MediaPayload = {
    mediaName: string;
    mediaType: string;
    mediaFormat: string;
    mediaUrl: string;
};

interface FileUploadContextType {
    attachedMedia: AttachedMedia[];
    mediaPayload: MediaPayload[];
    mediaUploadStatus: "IDLE" | "UPLOADING" | "SUCCESS" | "ERROR";
    handleFileChange: (
        files: FileList,
        userId: string,
        folderName: string,
    ) => Promise<void>;
    removeMedia: (index: number) => void;
    setAttachedMedia: (media: AttachedMedia[]) => void;
    setMediaPayload: (payload: MediaPayload[]) => void;
    resetMedia: () => void;
}

const FileUploadContext = createContext<FileUploadContextType | undefined>(
    undefined,
);

export function FileUploadProvider({ children }: { children: ReactNode }) {
    const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
    const [mediaPayload, setMediaPayload] = useState<MediaPayload[]>([]);
    const [mediaUploadStatus, setMediaUploadStatus] = useState<
        "IDLE" | "UPLOADING" | "SUCCESS" | "ERROR"
    >("IDLE");

    const handleFileChange = async (
        files: FileList,
        userId: string,
        folderName: string,
    ) => {
        if (files && files.length > 0) {
            const filesArray = Array.from(files);
            const newMedia = filesArray.map((file) => ({
                file,
                preview: URL.createObjectURL(file),
            }));
            setAttachedMedia((prev) => [...prev, ...newMedia]);

            const formData = new FormData();
            filesArray.forEach((file) => {
                formData.append("file", file);
            });
            formData.append("userId", userId);
            formData.append("folderName", folderName);

            setMediaUploadStatus("UPLOADING");
            try {
                const response = await fetch("/api/client-requests/chat/upload-media", {
                    method: "POST",
                    body: formData,
                    headers: {
                        Authorization: StudioConfig.studioSettings.database.fileUpload?.apiKey || '',
                    },
                });

                if (!response.ok) {
                    throw new Error("Failed to upload media");
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || "Failed to upload media");
                }

                setMediaPayload((prev) => [...prev, ...data.media]);
                setMediaUploadStatus("SUCCESS");
            } catch (error) {
                toast.error("Failed to upload media");
                console.error("Error uploading media:", error);
                setMediaUploadStatus("ERROR");
            }
        }
    };

    const removeMedia = (index: number) => {
        setMediaPayload((prev) => prev.filter((_, i) => i !== index));
        setAttachedMedia((prev) => {
            const updated = [...prev];
            if (updated[index]?.preview) {
                URL.revokeObjectURL(updated[index].preview);
            }
            updated.splice(index, 1);
            return updated;
        });
        //TODO: delete file from backend
    };

    const resetMedia = () => {
        attachedMedia.forEach((media) => URL.revokeObjectURL(media.preview));
        setAttachedMedia([]);
        setMediaPayload([]);
        setMediaUploadStatus("IDLE");
    };

    return (
        <FileUploadContext.Provider
            value={{
                attachedMedia,
                mediaPayload,
                mediaUploadStatus,
                handleFileChange,
                removeMedia,
                setAttachedMedia,
                setMediaPayload,
                resetMedia,
            }}
        >
            {children}
        </FileUploadContext.Provider>
    );
}

export function useFileUpload() {
    const context = useContext(FileUploadContext);
    if (context === undefined) {
        throw new Error("useFileUpload must be used within a FileUploadProvider");
    }
    return context;
}
