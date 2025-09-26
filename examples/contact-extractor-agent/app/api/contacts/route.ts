
import { NextResponse } from 'next/server';
import { getContacts, searchContacts } from '@/app/ai/agents/contactExtractorAgent/helpers/storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const topK = searchParams.get('topK');

  try {
    if (query) {
      const contacts = await searchContacts(query, topK ? parseInt(topK, 10) : 10);
      return NextResponse.json(contacts);
    } else {
      const contacts = await getContacts();
      return NextResponse.json(contacts);
    }
  } catch (error) {
    console.error('Error in contacts API:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
