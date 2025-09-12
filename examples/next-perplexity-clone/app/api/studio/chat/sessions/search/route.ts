import {
  ChatSessionData,
  sesionLocalStore,
  sessionLocalListOut,
} from '@/app/api/studio/chat/sessions/chatSessionLocal';
import { sessionStore } from '@/app/api/studio/chat/sessions/chatSessionUpstash';
import { StudioConfig } from '@/microfox.config';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
    const sessions = await sessionStore.list();
    const filteredSessions = sessions.filter((session) =>
      session.title.toLowerCase().includes(query?.toLowerCase() ?? ''),
    );
    return NextResponse.json(filteredSessions, { status: 200 });
  } else {
    const sessionIds = await sessionLocalListOut();
    const sessions = (
      await Promise.all(
        sessionIds.map(async (sessionId: string) => {
          const store = await sesionLocalStore(sessionId);
          const session = await store?.get<ChatSessionData>('sessionData');
          return session?.session;
        }),
      )
    ).filter((session) => session !== null);
    return NextResponse.json(sessions, { status: 200 });
  }
}
