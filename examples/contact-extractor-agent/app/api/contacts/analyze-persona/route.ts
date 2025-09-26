
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { contactId, urls } = await request.json();

    if (!contactId || !urls || !Array.isArray(urls)) {
      return NextResponse.json({ message: 'Missing contactId or urls' }, { status: 400 });
    }

    const response = await fetch(`/api/studio/chat/agent/extract/deep-persona?contactId=${contactId}&urls=${urls}`);
    const result = await response.json();

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error in analyze-persona API:', error);
    return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
  }
}
