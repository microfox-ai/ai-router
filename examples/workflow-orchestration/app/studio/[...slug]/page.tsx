"use client";

import { PlaceholderPage } from "@/components/studio/layout/PlaceholderPage";


const StudioRouter = async ({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string | string[] }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) => {

    const { slug } = await params;
    const allParams = await searchParams;

    if (Array.isArray(slug)) {
        return <PlaceholderPage title="Coming Soon" description="This feature is in development. Check github for updates..." />
    }
    else {
        return <PlaceholderPage title="No Chat Selected" description="Please select a chat from the sidebar or start a new chat." />
    }

}

export default StudioRouter;