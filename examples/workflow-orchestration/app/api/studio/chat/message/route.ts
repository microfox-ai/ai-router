import {
  messageStore,
  sessionStore,
} from '@/app/api/studio/chat/sessions/chatSessionUpstash';
import {
  ChatSessionData,
  sesionLocalStore,
} from '@/app/api/studio/chat/sessions/chatSessionLocal';
import { NextRequest, NextResponse } from 'next/server';
import { StudioConfig } from '@/microfox.config';

// Create Chat message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    //console.log("body", body);
    if (!body.id) {
      return NextResponse.json(
        { error: 'Message id is required' },
        { status: 400 },
      );
    }
    if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
      const message = await messageStore.set(body.id, {
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json(message, { status: 200 });
    } else {
      const store = await sesionLocalStore(body.sessionId);
      const message = {
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const sessionData = await store?.get<ChatSessionData>('sessionData');
      if (sessionData) {
        await store?.set('sessionData', {
          ...sessionData,
          messages: [...(sessionData?.messages ?? []), message],
        });
      } else {
        await store?.set('sessionData', {
          messages: [message],
        });
      }
      return NextResponse.json(message, { status: 200 });
    }
  } catch (error) {
    console.error('Error creating Chat message:', error);
    return NextResponse.json(
      { error: 'Error creating Chat message' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
    const message = await messageStore.update(body.id, body);
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
  } else {
    const store = await sesionLocalStore(body.sessionId);
    const sessionData = await store?.get<ChatSessionData>('sessionData');
    const message = sessionData?.messages.find(
      (message) => message.id === body.id,
    );
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    await store?.set('sessionData', {
      ...sessionData,
      messages: sessionData?.messages.map((message) =>
        message.id === body.id ? body : message,
      ),
    });
  }
  return NextResponse.json(body, { status: 200 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const sessionId = searchParams.get('sessionId');

  if (!id && !sessionId) {
    return NextResponse.json(
      { error: 'Id or sessionId is required' },
      { status: 400 },
    );
  }
  if (id) {
    if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
      const messages = await messageStore.get(id);
      return NextResponse.json(messages);
    } else {
      const store = await sesionLocalStore(id.split('-')[0]);
      const sessionData = await store?.get<ChatSessionData>('sessionData');
      const message = sessionData?.messages.find(
        (message) => message.id === id,
      );
      return NextResponse.json(message);
    }
  } else if (sessionId) {
    if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
      console.log('sessionId', sessionId);
      const messages = await messageStore.query(`${sessionId}-*`, {
        count: 1000,
        offset: 0,
      });
      return NextResponse.json(
        messages.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
    } else {
      const store = await sesionLocalStore(sessionId);
      const sessionData = await store?.get<ChatSessionData>('sessionData');
      return NextResponse.json(
        sessionData?.messages.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
    }
  }

  return NextResponse.json([]);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get('ids');
  let sessionId = searchParams.get('sessionId');
  const idsArray = ids?.split(',');
  //console.log("idsArray", idsArray, sessionId);
  if (!idsArray || !sessionId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (StudioConfig.studioSettings.database.type === 'upstash-redis') {
    const deletes = idsArray.map((id) => messageStore.del(id));
    const message = await Promise.all(deletes);
    return NextResponse.json(
      {
        success: message.length > 0 ? true : false,
        count: message.length,
      },
      { status: 200 },
    );
  } else {
    if (!sessionId) {
      sessionId = idsArray[0].split('-')[0];
    }
    const store = await sesionLocalStore(sessionId);
    const sessionData = await store?.get<ChatSessionData>('sessionData');
    const messages = sessionData?.messages.filter(
      (message) => !idsArray.includes(message.id),
    );
    await store?.set('sessionData', {
      ...sessionData,
      messages: messages,
    });
    return NextResponse.json(
      {
        success: idsArray && idsArray?.length > 0 ? true : false,
        count: idsArray?.length,
      },
      { status: 200 },
    );
  }
}
